/**
 * Standard ELO rating system for battle mode.
 * K=32, starting rating 1200.
 */

const K = 32;

/** Expected score (probability of winning) for player A against player B. */
function expectedScore(ratingA: number, ratingB: number): number {
	return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Compute ELO changes after a battle.
 * Returns the delta for winner and loser (winner gets +, loser gets -).
 */
export function computeEloChange(
	winnerElo: number,
	loserElo: number
): { winnerDelta: number; loserDelta: number } {
	const expectedWin = expectedScore(winnerElo, loserElo);
	const winnerDelta = Math.round(K * (1 - expectedWin));
	const loserDelta = -Math.round(K * expectedWin);
	return { winnerDelta, loserDelta };
}
