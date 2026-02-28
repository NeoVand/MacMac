import type * as Party from 'partykit/server';
import type { ClientMessage, ServerMessage, StartMessage, OpponentKdeMessage, BattleEndMessage, JackpotMessage } from './shared/protocol';
import type { PlayerInfo } from './shared/types';
import { signBattleResult } from './shared/crypto';

const BATTLE_DURATION_MS = 30_000;
const KDE_BROADCAST_INTERVAL_MS = 200;
const JACKPOT_THRESHOLD = 98; // match % for instant win
const DISCONNECT_GRACE_MS = 10_000;
const COUNTDOWN_SECONDS = 3;
const KDE_EVAL_POINTS = 200;
const MAX_SAMPLES = 200;
const MAX_SAMPLE_RATE_MS = 50; // min ms between samples

// --- Inline math (can't import from SvelteKit) ---

function computeBandwidth(samples: number[]): number {
	const n = samples.length;
	const mean = samples.reduce((a, b) => a + b, 0) / n;
	const variance = n > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
	const std = Math.sqrt(variance);
	const scottH = std > 0 ? 1.06 * std * Math.pow(n, -0.2) : 0;
	const floor = 0.35 / Math.pow(n, 0.35);
	return Math.min(Math.max(floor, scottH), 0.5);
}

function computeKDE(samples: number[], evalPoints: number[]): number[] {
	const n = samples.length;
	if (n === 0) return evalPoints.map(() => 0);
	const bandwidth = computeBandwidth(samples);
	const invH = 1 / bandwidth;
	const coeff = invH / (n * Math.sqrt(2 * Math.PI));
	return evalPoints.map((x) => {
		let sum = 0;
		for (let i = 0; i < n; i++) {
			const z = (x - samples[i]) * invH;
			sum += Math.exp(-0.5 * z * z);
		}
		return coeff * sum;
	});
}

function linspace(start: number, end: number, n: number): number[] {
	if (n <= 1) return [start];
	const step = (end - start) / (n - 1);
	return Array.from({ length: n }, (_, i) => start + i * step);
}

function gaussian(x: number, mean: number, std: number): number {
	const z = (x - mean) / std;
	return Math.exp(-0.5 * z * z) / (std * Math.sqrt(2 * Math.PI));
}

// Minimal seeded PRNG (Mulberry32) — matches client exactly
class SeededRandom {
	private state: number;
	constructor(seed: number) { this.state = seed | 0; }
	next(): number {
		this.state |= 0;
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	range(min: number, max: number): number { return min + this.next() * (max - min); }
	int(min: number, max: number): number { return Math.floor(this.range(min, max + 1)); }
	gaussian(mean = 0, std = 1): number {
		const u1 = this.next() || 1e-10;
		const u2 = this.next();
		const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
		return mean + z * std;
	}
}

// Minimal level generation (matches client generateLevel exactly)
function generateHiddenClicks(seed: number, targetDifficulty: number): { hiddenClicks: number[]; xRange: [number, number] } {
	const d = Math.max(1, Math.min(10, targetDifficulty));
	const rng = new SeededRandom(seed);
	const nModes = Math.max(1, Math.min(7, Math.round(0.5 + d * 0.65)));
	const nClicks = Math.max(3, Math.min(45, Math.round(2 + d * 4.3)));
	const minSep = 2.2 - d * 0.14;
	const hVar = d * 0.07;
	const noise = Math.max(0, (d - 4) * 0.03);

	const centers: number[] = [rng.range(-2, 2)];
	for (let m = 1; m < nModes; m++) {
		const spread = 3 + nModes * 0.5;
		let center: number;
		let attempts = 0;
		do {
			center = rng.range(centers[0] - spread, centers[0] + spread);
			attempts++;
		} while (attempts < 50 && centers.some(c => Math.abs(c - center) < minSep));
		centers.push(center);
	}
	centers.sort((a, b) => a - b);

	const weights = centers.map(() => Math.max(0.1, rng.range(1 - hVar, 1 + hVar)));
	const weightSum = weights.reduce((a, b) => a + b, 0);
	const mainClicks = Math.max(nClicks - Math.floor(noise * nClicks), nModes);
	const clicksPerMode = weights.map(w => Math.max(1, Math.round((mainClicks * w) / weightSum)));

	let currentTotal = clicksPerMode.reduce((a, b) => a + b, 0);
	while (currentTotal < mainClicks) { clicksPerMode[rng.int(0, clicksPerMode.length - 1)]++; currentTotal++; }
	while (currentTotal > mainClicks) {
		const idx = rng.int(0, clicksPerMode.length - 1);
		if (clicksPerMode[idx] > 1) { clicksPerMode[idx]--; currentTotal--; }
	}

	const hiddenClicks: number[] = [];
	for (let m = 0; m < nModes; m++) {
		const sigma = 0.2 + rng.next() * 0.3;
		for (let j = 0; j < clicksPerMode[m]; j++) {
			hiddenClicks.push(centers[m] + rng.gaussian(0, sigma));
		}
	}

	const noiseCount = Math.floor(noise * nClicks);
	if (noiseCount > 0) {
		const rangeMin = Math.min(...hiddenClicks) - 1;
		const rangeMax = Math.max(...hiddenClicks) + 1;
		for (let i = 0; i < noiseCount; i++) hiddenClicks.push(rng.range(rangeMin, rangeMax));
	}

	for (let i = 0; i < hiddenClicks.length; i++) {
		hiddenClicks[i] = Math.round(hiddenClicks[i] * 100) / 100;
	}

	const extent = Math.max(...hiddenClicks) - Math.min(...hiddenClicks);
	const padding = Math.max(2.5, extent * 0.2);
	const xMin = Math.floor((Math.min(...hiddenClicks) - padding) * 2) / 2;
	const xMax = Math.ceil((Math.max(...hiddenClicks) + padding) * 2) / 2;

	return { hiddenClicks, xRange: [xMin, xMax] };
}

function kernelTargetPdf(hiddenClicks: number[]): (x: number) => number {
	const bw = computeBandwidth(hiddenClicks);
	const n = hiddenClicks.length;
	return (x: number) => {
		let sum = 0;
		for (let i = 0; i < n; i++) sum += gaussian(x, hiddenClicks[i], bw);
		return sum / n;
	};
}

function computeMatchPct(samples: number[], hiddenClicks: number[], xRange: [number, number]): number {
	const xs = linspace(xRange[0], xRange[1], 200);
	const pdf = kernelTargetPdf(hiddenClicks);
	const pVals = xs.map(x => pdf(x));
	const qVals = computeKDE(samples, xs);
	const pMax = Math.max(...pVals);
	const qMax = Math.max(...qVals);
	let mse = 0;
	for (let i = 0; i < 200; i++) {
		const p = pMax > 0 ? pVals[i] / pMax : 0;
		const q = qMax > 0 ? qVals[i] / qMax : 0;
		mse += (p - q) ** 2;
	}
	mse /= 200;
	return Math.round((1 / (1 + 100 * mse)) * 100);
}

function computeScore(mse: number, elapsedMs: number): number {
	const matchScore = Math.round(8000 / (1 + 100 * mse));
	const timeBonus = Math.round(2000 * Math.max(0, 1 - Math.max(0, elapsedMs) / 30000));
	return matchScore + timeBonus;
}

// --- Battle state ---

interface PlayerState {
	info: PlayerInfo;
	connectionId: string;
	samples: number[];
	lastKde: number[];
	matchPct: number;
	connected: boolean;
	disconnectedAt: number | null;
	lastSampleTime: number;
}

type BattlePhase = 'waiting' | 'countdown' | 'playing' | 'ended';

export default class BattleServer implements Party.Server {
	private phase: BattlePhase = 'waiting';
	private players: Map<string, PlayerState> = new Map();
	private seed = 0;
	private targetDifficulty = 5.0;
	private hiddenClicks: number[] = [];
	private xRange: [number, number] = [0, 1];
	private evalPoints: number[] = [];
	private startTime = 0;
	private countdownTimer: ReturnType<typeof setInterval> | null = null;
	private kdeTimer: ReturnType<typeof setInterval> | null = null;
	private endTimer: ReturnType<typeof setTimeout> | null = null;
	private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	constructor(readonly room: Party.Room) {}

	onConnect(conn: Party.Connection) {
		// Connection established, wait for join message
	}

	onClose(conn: Party.Connection) {
		// Find which player disconnected
		for (const [id, player] of this.players) {
			if (player.connectionId === conn.id) {
				player.connected = false;
				player.disconnectedAt = Date.now();

				if (this.phase === 'playing') {
					// Grace period — opponent wins if they don't reconnect
					const timer = setTimeout(() => {
						this.handleDisconnectLoss(id);
					}, DISCONNECT_GRACE_MS);
					this.disconnectTimers.set(id, timer);
				}
				break;
			}
		}
	}

	onMessage(message: string, sender: Party.Connection) {
		let msg: ClientMessage;
		try {
			msg = JSON.parse(message);
		} catch {
			return;
		}

		switch (msg.type) {
			case 'join':
				this.handleJoin(msg, sender);
				break;
			case 'add_sample':
				this.handleAddSample(msg, sender);
				break;
		}
	}

	private handleJoin(msg: ClientMessage & { type: 'join' }, conn: Party.Connection) {
		const existing = this.players.get(msg.playerId);

		if (existing) {
			// Reconnecting
			existing.connectionId = conn.id;
			existing.connected = true;
			existing.disconnectedAt = null;

			const timer = this.disconnectTimers.get(msg.playerId);
			if (timer) {
				clearTimeout(timer);
				this.disconnectTimers.delete(msg.playerId);
			}

			// Send current state
			if (this.phase === 'playing') {
				const opponent = [...this.players.values()].find(p => p.info.playerId !== msg.playerId);
				conn.send(JSON.stringify({
					type: 'start',
					seed: this.seed,
					targetDifficulty: this.targetDifficulty,
					opponentName: opponent?.info.playerName ?? 'Opponent',
					opponentElo: opponent?.info.battleElo ?? 1200,
					opponentCountry: opponent?.info.country,
					durationMs: Math.max(0, BATTLE_DURATION_MS - (Date.now() - this.startTime))
				} satisfies StartMessage));
			} else if (this.phase === 'ended') {
				conn.send(JSON.stringify({ type: 'error', message: 'Battle has ended' }));
			}
			return;
		}

		if (this.phase === 'ended') {
			conn.send(JSON.stringify({ type: 'error', message: 'Battle has ended' }));
			return;
		}

		if (this.players.size >= 2) {
			conn.send(JSON.stringify({ type: 'error', message: 'Battle is full' }));
			return;
		}

		this.players.set(msg.playerId, {
			info: { playerId: msg.playerId, playerName: msg.playerName, battleElo: msg.battleElo, country: msg.country },
			connectionId: conn.id,
			samples: [],
			lastKde: new Array(KDE_EVAL_POINTS).fill(0),
			matchPct: 0,
			connected: true,
			disconnectedAt: null,
			lastSampleTime: 0
		});

		if (this.players.size === 1) {
			conn.send(JSON.stringify({ type: 'waiting' }));
		} else if (this.players.size === 2) {
			this.initBattle();
		}
	}

	private initBattle() {
		// Parse battle config from room id: "seed-difficulty"
		const parts = this.room.id.split('-');
		this.seed = parseInt(parts[0], 10) || Date.now();
		this.targetDifficulty = parseFloat(parts[1]) || 5.0;

		const { hiddenClicks, xRange } = generateHiddenClicks(this.seed, this.targetDifficulty);
		this.hiddenClicks = hiddenClicks;
		this.xRange = xRange;
		this.evalPoints = linspace(xRange[0], xRange[1], KDE_EVAL_POINTS);

		this.startCountdown();
	}

	private startCountdown() {
		this.phase = 'countdown';
		let remaining = COUNTDOWN_SECONDS;

		this.broadcast({ type: 'countdown', seconds: remaining });

		this.countdownTimer = setInterval(() => {
			remaining--;
			if (remaining > 0) {
				this.broadcast({ type: 'countdown', seconds: remaining });
			} else {
				if (this.countdownTimer) clearInterval(this.countdownTimer);
				this.countdownTimer = null;
				this.startBattle();
			}
		}, 1000);
	}

	private startBattle() {
		this.phase = 'playing';
		this.startTime = Date.now();

		const playerList = [...this.players.values()];

		// Send start message to each player with their opponent's info
		for (const player of playerList) {
			const opponent = playerList.find(p => p.info.playerId !== player.info.playerId);
			const conn = this.getConnection(player.connectionId);
			if (conn) {
				conn.send(JSON.stringify({
					type: 'start',
					seed: this.seed,
					targetDifficulty: this.targetDifficulty,
					opponentName: opponent?.info.playerName ?? 'Opponent',
					opponentElo: opponent?.info.battleElo ?? 1200,
					opponentCountry: opponent?.info.country,
					durationMs: BATTLE_DURATION_MS
				} satisfies StartMessage));
			}
		}

		// Broadcast KDE updates at ~5Hz
		this.kdeTimer = setInterval(() => {
			this.broadcastKde();
		}, KDE_BROADCAST_INTERVAL_MS);

		// End battle after time limit
		this.endTimer = setTimeout(() => {
			this.endBattle();
		}, BATTLE_DURATION_MS);
	}

	private handleAddSample(msg: ClientMessage & { type: 'add_sample' }, conn: Party.Connection) {
		if (this.phase !== 'playing') return;

		// Find the player
		const player = [...this.players.values()].find(p => p.connectionId === conn.id);
		if (!player) return;

		// Validate sample value
		if (typeof msg.x !== 'number' || !Number.isFinite(msg.x)) return;
		if (msg.x < this.xRange[0] || msg.x > this.xRange[1]) return;

		// Rate limit and cap
		if (player.samples.length >= MAX_SAMPLES) return;
		const now = Date.now();
		if (now - player.lastSampleTime < MAX_SAMPLE_RATE_MS) return;
		player.lastSampleTime = now;

		player.samples.push(msg.x);

		// Recompute KDE and match %
		if (player.samples.length > 0) {
			player.lastKde = computeKDE(player.samples, this.evalPoints);
			player.matchPct = computeMatchPct(player.samples, this.hiddenClicks, this.xRange);

			// Check jackpot
			if (player.matchPct >= JACKPOT_THRESHOLD) {
				this.handleJackpot(player);
			}
		}
	}

	private handleJackpot(winner: PlayerState) {
		if (this.phase !== 'playing') return;
		this.phase = 'ended';
		this.cleanup();

		const elapsed = Date.now() - this.startTime;
		const mse = this.computeMse(winner.samples);
		const score = computeScore(mse, elapsed);

		this.broadcast({
			type: 'jackpot',
			winnerId: winner.info.playerId,
			winnerName: winner.info.playerName,
			winnerScore: score,
			winnerMatchPct: winner.matchPct
		} satisfies JackpotMessage);

		// Send results (client reports ELO via signed token)
		const loser = [...this.players.values()].find(p => p.info.playerId !== winner.info.playerId);
		if (loser) {
			const loserMse = this.computeMse(loser.samples);
			const loserScore = computeScore(loserMse, elapsed);

			this.sendEndMessages(winner, score, winner.matchPct, loser, loserScore, loser.matchPct);
		}
	}

	private broadcastKde() {
		if (this.phase !== 'playing') return;

		const playerList = [...this.players.values()];
		for (const player of playerList) {
			const opponent = playerList.find(p => p.info.playerId !== player.info.playerId);
			if (!opponent) continue;

			const conn = this.getConnection(player.connectionId);
			if (conn && player.connected) {
				conn.send(JSON.stringify({
					type: 'opponent_kde',
					kde: opponent.lastKde,
					matchPct: opponent.matchPct
				} satisfies OpponentKdeMessage));
			}
		}
	}

	private endBattle() {
		if (this.phase !== 'playing') return;
		this.phase = 'ended';
		this.cleanup();

		const elapsed = BATTLE_DURATION_MS;
		const playerList = [...this.players.values()];

		if (playerList.length < 2) return;

		const [p1, p2] = playerList;
		const p1Mse = this.computeMse(p1.samples);
		const p2Mse = this.computeMse(p2.samples);
		const p1Score = computeScore(p1Mse, elapsed);
		const p2Score = computeScore(p2Mse, elapsed);

		const winner = p1Score >= p2Score ? p1 : p2;
		const loser = p1Score >= p2Score ? p2 : p1;
		const winnerScore = Math.max(p1Score, p2Score);
		const loserScore = Math.min(p1Score, p2Score);

		this.sendEndMessages(winner, winnerScore, winner.matchPct, loser, loserScore, loser.matchPct);
	}

	private async sendEndMessages(
		winner: PlayerState, winnerScore: number, winnerMatchPct: number,
		loser: PlayerState, loserScore: number, loserMatchPct: number
	) {
		// Compute ELO deltas
		const expectedWin = 1 / (1 + Math.pow(10, (loser.info.battleElo - winner.info.battleElo) / 400));
		const winnerDelta = Math.round(32 * (1 - expectedWin));
		const loserDelta = -Math.round(32 * expectedWin);

		const secret = this.room.env.PARTYKIT_SECRET as string | undefined;

		for (const player of this.players.values()) {
			const isWinner = player.info.playerId === winner.info.playerId;
			const eloDelta = isWinner ? winnerDelta : loserDelta;
			const conn = this.getConnection(player.connectionId);
			if (conn) {
				// Sign a result token for this player (if secret is configured)
				let resultToken: string | undefined;
				if (secret) {
					try {
						resultToken = await signBattleResult({
							battleId: this.room.id,
							playerId: player.info.playerId,
							won: isWinner,
							eloDelta,
							ts: Date.now()
						}, secret);
					} catch {
						// Non-critical — player can still see results
					}
				}

				const opponent = isWinner ? loser : winner;
				conn.send(JSON.stringify({
					type: 'battle_end',
					winnerId: winner.info.playerId,
					winnerName: winner.info.playerName,
					winnerScore,
					winnerMatchPct,
					loserScore,
					loserMatchPct,
					yourEloDelta: eloDelta,
					resultToken,
					opponentSamples: opponent.samples
				} satisfies BattleEndMessage));
			}
		}
	}

	private handleDisconnectLoss(disconnectedPlayerId: string) {
		if (this.phase !== 'playing') return;
		this.phase = 'ended';
		this.cleanup();

		const loser = this.players.get(disconnectedPlayerId);
		const winner = [...this.players.values()].find(p => p.info.playerId !== disconnectedPlayerId);

		if (winner && loser) {
			const elapsed = Date.now() - this.startTime;
			const winnerMse = this.computeMse(winner.samples);
			const loserMse = this.computeMse(loser.samples);
			const winnerScore = computeScore(winnerMse, elapsed);
			const loserScore = computeScore(loserMse, elapsed);

			this.sendEndMessages(winner, winnerScore, winner.matchPct, loser, loserScore, loser.matchPct);
		}
	}

	private computeMse(samples: number[]): number {
		if (samples.length === 0) return 1;
		const pdf = kernelTargetPdf(this.hiddenClicks);
		const xs = this.evalPoints;
		const pVals = xs.map(x => pdf(x));
		const qVals = computeKDE(samples, xs);
		const pMax = Math.max(...pVals);
		const qMax = Math.max(...qVals);
		let mse = 0;
		for (let i = 0; i < xs.length; i++) {
			const p = pMax > 0 ? pVals[i] / pMax : 0;
			const q = qMax > 0 ? qVals[i] / qMax : 0;
			mse += (p - q) ** 2;
		}
		return mse / xs.length;
	}

	private broadcast(msg: ServerMessage) {
		const data = JSON.stringify(msg);
		for (const conn of this.room.getConnections()) {
			conn.send(data);
		}
	}

	private getConnection(id: string): Party.Connection | undefined {
		for (const conn of this.room.getConnections()) {
			if (conn.id === id) return conn;
		}
		return undefined;
	}

	private cleanup() {
		if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null; }
		if (this.kdeTimer) { clearInterval(this.kdeTimer); this.kdeTimer = null; }
		if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
		for (const timer of this.disconnectTimers.values()) clearTimeout(timer);
		this.disconnectTimers.clear();
	}
}
