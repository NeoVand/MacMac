import type * as Party from 'partykit/server';

/**
 * Matchmaker — single global Durable Object managing the queue.
 *
 * Players join with { playerId, playerName, battleElo, country }.
 * Matchmaker finds closest-ELO pair within an expanding range
 * (base ±200, +100 per 10s waiting). On match, sends both
 * players the battle room ID to connect to.
 */

interface QueueEntry {
	connectionId: string;
	playerId: string;
	playerName: string;
	battleElo: number;
	country?: string | null;
	joinedAt: number;
}

interface JoinQueueMessage {
	type: 'join_queue';
	playerId: string;
	playerName: string;
	battleElo: number;
	country?: string | null;
}

interface LeaveQueueMessage {
	type: 'leave_queue';
}

type MatchmakerClientMessage = JoinQueueMessage | LeaveQueueMessage;

interface MatchFoundMessage {
	type: 'match_found';
	battleId: string;
	seed: number;
	targetDifficulty: number;
	opponentName: string;
	opponentElo: number;
	opponentCountry?: string | null;
}

interface QueueStatusMessage {
	type: 'queue_status';
	position: number;
	waitingCount: number;
}

const BASE_ELO_RANGE = 200;
const ELO_RANGE_EXPANSION = 100; // per 10s waiting
const MATCH_CHECK_INTERVAL_MS = 2000;

export default class Matchmaker implements Party.Server {
	private queue: Map<string, QueueEntry> = new Map();
	private matchTimer: ReturnType<typeof setInterval> | null = null;

	constructor(readonly room: Party.Room) {}

	/**
	 * HTTP endpoint for lightweight polling: GET /parties/matchmaker/global
	 * Returns { searching: <number> } — how many players are in the queue.
	 */
	async onRequest(req: Party.Request): Promise<Response> {
		return new Response(
			JSON.stringify({ searching: this.queue.size }),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'no-store'
				}
			}
		);
	}

	onConnect(conn: Party.Connection) {
		// Wait for join_queue message
	}

	onClose(conn: Party.Connection) {
		// Remove from queue
		for (const [id, entry] of this.queue) {
			if (entry.connectionId === conn.id) {
				this.queue.delete(id);
				break;
			}
		}
		this.updateMatchTimer();
	}

	onMessage(message: string, sender: Party.Connection) {
		let msg: MatchmakerClientMessage;
		try {
			msg = JSON.parse(message);
		} catch {
			return;
		}

		switch (msg.type) {
			case 'join_queue':
				this.handleJoinQueue(msg, sender);
				break;
			case 'leave_queue':
				this.handleLeaveQueue(sender);
				break;
		}
	}

	private handleJoinQueue(msg: JoinQueueMessage, conn: Party.Connection) {
		// Remove any existing entry for this player
		this.queue.delete(msg.playerId);

		this.queue.set(msg.playerId, {
			connectionId: conn.id,
			playerId: msg.playerId,
			playerName: msg.playerName,
			battleElo: msg.battleElo,
			country: msg.country,
			joinedAt: Date.now()
		});

		// Send queue status
		conn.send(JSON.stringify({
			type: 'queue_status',
			position: this.queue.size,
			waitingCount: this.queue.size
		} satisfies QueueStatusMessage));

		// Try to match immediately
		this.tryMatch();
		this.updateMatchTimer();
	}

	private handleLeaveQueue(conn: Party.Connection) {
		for (const [id, entry] of this.queue) {
			if (entry.connectionId === conn.id) {
				this.queue.delete(id);
				break;
			}
		}
		this.updateMatchTimer();
	}

	private updateMatchTimer() {
		if (this.queue.size >= 2 && !this.matchTimer) {
			this.matchTimer = setInterval(() => this.tryMatch(), MATCH_CHECK_INTERVAL_MS);
		} else if (this.queue.size < 2 && this.matchTimer) {
			clearInterval(this.matchTimer);
			this.matchTimer = null;
		}
	}

	private tryMatch() {
		if (this.queue.size < 2) return;

		const now = Date.now();
		const entries = [...this.queue.values()];

		// Sort by join time (oldest first gets priority)
		entries.sort((a, b) => a.joinedAt - b.joinedAt);

		for (let i = 0; i < entries.length; i++) {
			const a = entries[i];
			const waitTimeA = (now - a.joinedAt) / 1000; // seconds
			const rangeA = BASE_ELO_RANGE + Math.floor(waitTimeA / 10) * ELO_RANGE_EXPANSION;

			for (let j = i + 1; j < entries.length; j++) {
				const b = entries[j];
				const waitTimeB = (now - b.joinedAt) / 1000;
				const rangeB = BASE_ELO_RANGE + Math.floor(waitTimeB / 10) * ELO_RANGE_EXPANSION;

				const eloDiff = Math.abs(a.battleElo - b.battleElo);

				if (eloDiff <= Math.max(rangeA, rangeB)) {
					this.createMatch(a, b);
					return;
				}
			}
		}
	}

	private createMatch(a: QueueEntry, b: QueueEntry) {
		// Remove from queue
		this.queue.delete(a.playerId);
		this.queue.delete(b.playerId);

		// Generate battle params
		const seed = Date.now();
		const avgElo = (a.battleElo + b.battleElo) / 2;
		// Map ELO to difficulty: 1200 → ~4, 1600 → ~7, 800 → ~2
		const targetDifficulty = Math.round(Math.max(1, Math.min(10, 2 + (avgElo - 800) * 0.0075)) * 10) / 10;
		const battleId = `${seed}-${targetDifficulty}`;

		// Send match_found to both players
		const connA = this.getConnection(a.connectionId);
		const connB = this.getConnection(b.connectionId);

		if (connA) {
			connA.send(JSON.stringify({
				type: 'match_found',
				battleId,
				seed,
				targetDifficulty,
				opponentName: b.playerName,
				opponentElo: b.battleElo,
				opponentCountry: b.country
			} satisfies MatchFoundMessage));
		}

		if (connB) {
			connB.send(JSON.stringify({
				type: 'match_found',
				battleId,
				seed,
				targetDifficulty,
				opponentName: a.playerName,
				opponentElo: a.battleElo,
				opponentCountry: a.country
			} satisfies MatchFoundMessage));
		}

		this.updateMatchTimer();
	}

	private getConnection(id: string): Party.Connection | undefined {
		for (const conn of this.room.getConnections()) {
			if (conn.id === id) return conn;
		}
		return undefined;
	}
}
