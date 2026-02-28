/**
 * WebSocket message protocol between client and battle server.
 *
 * Client → Server messages:
 *   join        - Player joins the battle room
 *   add_sample  - Player places a sample on the canvas
 *
 * Server → Client messages:
 *   waiting     - Waiting for opponent to join
 *   countdown   - 3-2-1 countdown tick
 *   start       - Battle begins, includes level data
 *   opponent_kde - Opponent's KDE curve update (~5Hz)
 *   jackpot     - A player hit ≥98% match accuracy — instant win
 *   battle_end  - Battle is over, includes results
 *   error       - Something went wrong
 */

// --- Client → Server ---

export interface JoinMessage {
	type: 'join';
	playerId: string;
	playerName: string;
	battleElo: number;
	country?: string | null;
}

export interface AddSampleMessage {
	type: 'add_sample';
	x: number;
}

export type ClientMessage = JoinMessage | AddSampleMessage;

// --- Server → Client ---

export interface WaitingMessage {
	type: 'waiting';
}

export interface CountdownMessage {
	type: 'countdown';
	seconds: number; // 3, 2, 1
}

export interface StartMessage {
	type: 'start';
	seed: number;
	targetDifficulty: number;
	opponentName: string;
	opponentElo: number;
	opponentCountry?: string | null;
	durationMs: number; // 20000
}

export interface OpponentKdeMessage {
	type: 'opponent_kde';
	kde: number[]; // 200 floats
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
	resultToken?: string; // HMAC-signed token for secure ELO reporting
	opponentSamples: number[]; // opponent's raw click positions for replay
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
