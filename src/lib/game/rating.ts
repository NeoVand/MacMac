/**
 * Player rating and weighted scoring.
 *
 * - weightedScore = rawScore × (difficulty / BASE_DIFFICULTY)
 * - playerRating  = EMA of (difficulty × matchPct / 100)
 *
 * The rating tracks what difficulty the player can handle well,
 * naturally incentivizing pushing the difficulty boundary.
 */

const BASE_DIFFICULTY = 3.0;

/**
 * Compute the difficulty-weighted score.
 * Medium-difficulty levels (~3.0) get a 1× multiplier.
 */
export function computeWeightedScore(rawScore: number, difficulty: number): number {
	const multiplier = difficulty / BASE_DIFFICULTY;
	return Math.round(rawScore * multiplier);
}

/**
 * Update the player's rating using an exponential moving average.
 *
 * The alpha (learning rate) starts high for fast adaptation on new
 * players and decays as they play more games, stabilizing the rating.
 *
 * @param currentRating  Current EMA rating
 * @param difficulty     Difficulty of the level just played
 * @param matchPct       Match percentage achieved (0–100)
 * @param gamesPlayed    Total games played before this one
 */
export function computeNewRating(
	currentRating: number,
	difficulty: number,
	matchPct: number,
	gamesPlayed: number
): number {
	const performance = (difficulty * matchPct) / 100;
	const alpha = Math.max(0.1, 0.3 - gamesPlayed * 0.004);
	return currentRating + alpha * (performance - currentRating);
}
