import type { BattleEndMessage } from '../battle/protocol.ts';
import { gameStorage, type GameStorage } from './pending-game.ts';

export interface PendingBattle {
	version: 1;
	battleId: string;
	playerId: string;
	seed: number;
	targetDifficulty: number;
	durationMs: number;
	result: BattleEndMessage;
	samples: number[];
	opponentName: string;
	opponentElo: number;
	opponentCountry: string | null;
	isJackpot: boolean;
	jackpotMatchPct: number;
	showYou: boolean;
	showOpponent: boolean;
	pendingReport: boolean;
	requestSent: boolean;
}

export function pendingBattleKey(battleId: string): string {
	return `macmac_battle_result:v1:${encodeURIComponent(battleId)}`;
}

function numeric(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function sampleList(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length <= 10_000 &&
		value.every((sample) => typeof sample === 'number' && Number.isFinite(sample))
	);
}

function parseBattle(raw: string, battleId: string): PendingBattle | null {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const state = value as Record<string, unknown>;
	const parts = /^(\d+)-(\d+(?:\.\d+)?)$/.exec(battleId);
	if (
		!parts ||
		state.version !== 1 ||
		state.battleId !== battleId ||
		!Number.isSafeInteger(state.seed) ||
		state.seed !== Number(parts[1]) ||
		!numeric(state.targetDifficulty, 1, 10) ||
		state.targetDifficulty !== Number(parts[2]) ||
		!numeric(state.durationMs, 1, 3_600_000) ||
		typeof state.playerId !== 'string' ||
		!state.playerId ||
		state.playerId.length > 200 ||
		!sampleList(state.samples) ||
		typeof state.opponentName !== 'string' ||
		state.opponentName.length > 200 ||
		!numeric(state.opponentElo, -100_000, 100_000) ||
		!(
			state.opponentCountry === null ||
			(typeof state.opponentCountry === 'string' && state.opponentCountry.length <= 16)
		) ||
		typeof state.isJackpot !== 'boolean' ||
		!numeric(state.jackpotMatchPct, 0, 100) ||
		typeof state.showYou !== 'boolean' ||
		typeof state.showOpponent !== 'boolean' ||
		typeof state.pendingReport !== 'boolean' ||
		typeof state.requestSent !== 'boolean' ||
		!state.result ||
		typeof state.result !== 'object' ||
		Array.isArray(state.result)
	)
		return null;
	const result = state.result as Record<string, unknown>;
	if (
		result.type !== 'battle_end' ||
		typeof result.won !== 'boolean' ||
		typeof result.winnerId !== 'string' ||
		result.winnerId.length > 200 ||
		typeof result.winnerName !== 'string' ||
		result.winnerName.length > 200 ||
		!numeric(result.yourScore, 0) ||
		!numeric(result.opponentScore, 0) ||
		!numeric(result.yourMatchPct, 0, 100) ||
		!numeric(result.opponentMatchPct, 0, 100) ||
		!numeric(result.yourEloDelta, -50, 50) ||
		!sampleList(result.opponentSamples) ||
		!(
			result.resultToken === undefined ||
			(typeof result.resultToken === 'string' &&
				result.resultToken.length <= 5000 &&
				/^[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(result.resultToken))
		) ||
		(state.pendingReport && !result.resultToken)
	)
		return null;
	return state as unknown as PendingBattle;
}

/** Restoration never consumes the signed result or opens a socket. */
export function readPendingBattle(battleId: string, storage = gameStorage()): PendingBattle | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(pendingBattleKey(battleId));
		return raw === null ? null : parseBattle(raw, battleId);
	} catch {
		return null;
	}
}

export function writePendingBattle(state: PendingBattle, storage = gameStorage()): boolean {
	if (!storage) return false;
	try {
		const raw = JSON.stringify(state);
		if (!parseBattle(raw, state.battleId)) return false;
		storage.setItem(pendingBattleKey(state.battleId), raw);
		return storage.getItem(pendingBattleKey(state.battleId)) === raw;
	} catch {
		return false;
	}
}

/** Only confirmation of this result can clear it; a stale response cannot clear another claim. */
export function clearPendingBattle(
	battleId: string,
	resultToken: string,
	storage: GameStorage | null = gameStorage()
): boolean {
	if (!storage) return false;
	try {
		const current = readPendingBattle(battleId, storage);
		if (current?.result.resultToken !== resultToken) return false;
		storage.removeItem(pendingBattleKey(battleId));
		return true;
	} catch {
		return false;
	}
}
