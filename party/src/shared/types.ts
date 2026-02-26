/** Player info sent when joining matchmaking or a battle. */
export interface PlayerInfo {
	playerId: string;
	playerName: string;
	battleElo: number;
	country?: string | null;
}

/** A matched pair ready to fight. */
export interface MatchResult {
	battleId: string;
	seed: number;
	targetDifficulty: number;
	player1: PlayerInfo;
	player2: PlayerInfo;
}

/** Battle outcome sent to the SvelteKit API. */
export interface BattleResult {
	battleId: string;
	winnerId: string;
	loserId: string;
	winnerScore: number;
	loserScore: number;
	seed: number;
	targetDifficulty: number;
}
