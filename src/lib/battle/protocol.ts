/**
 * WebSocket message protocol between client and battle server.
 * Mirrors party/src/shared/protocol.ts — keep in sync.
 */

// --- Server → Client ---

export interface WaitingMessage {
	type: 'waiting';
}

export interface CountdownMessage {
	type: 'countdown';
	seconds: number;
}

export interface StartMessage {
	type: 'start';
	seed: number;
	targetDifficulty: number;
	opponentName: string;
	opponentElo: number;
	opponentCountry?: string | null;
	durationMs: number;
}

export interface OpponentKdeMessage {
	type: 'opponent_kde';
	kde: number[];
	matchPct: number;
}

export interface JackpotMessage {
	type: 'jackpot';
	winnerId: string;
	winnerName: string;
	winnerScore: number;
	winnerMatchPct: number;
}

export interface BattleEndMessage {
	type: 'battle_end';
	winnerId: string;
	winnerName: string;
	winnerScore: number;
	winnerMatchPct: number;
	loserScore: number;
	loserMatchPct: number;
	yourEloDelta: number;
}

export interface ErrorMessage {
	type: 'error';
	message: string;
}

export type ServerMessage =
	| WaitingMessage
	| CountdownMessage
	| StartMessage
	| OpponentKdeMessage
	| JackpotMessage
	| BattleEndMessage
	| ErrorMessage;
