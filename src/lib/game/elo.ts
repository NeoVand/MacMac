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

// ─── Battle Rank Tiers ──────────────────────────────────────

export interface BattleTier {
	name: string;
	threshold: number;
	color: string;
}

export const BATTLE_TIERS: BattleTier[] = [
	{ name: 'Iron', threshold: 0, color: '#8b8b8b' },
	{ name: 'Bronze', threshold: 1000, color: '#b07c4a' },
	{ name: 'Silver', threshold: 1200, color: '#a8b4c4' },
	{ name: 'Gold', threshold: 1400, color: '#eab308' },
	{ name: 'Platinum', threshold: 1600, color: '#2dd4bf' },
	{ name: 'Diamond', threshold: 1800, color: '#38bdf8' },
	{ name: 'Genius', threshold: 2000, color: '#a855f7' }
];

/**
 * Get the battle tier for a given ELO.
 * Returns the highest tier whose threshold ≤ elo.
 */
export function getBattleTier(elo: number): BattleTier {
	let tier = BATTLE_TIERS[0];
	for (const t of BATTLE_TIERS) {
		if (elo >= t.threshold) tier = t;
		else break;
	}
	return tier;
}

/**
 * Get progress within the current battle tier (0–1).
 * Returns 1.0 if already at the highest tier.
 */
export function getBattleTierProgress(elo: number): number {
	const tier = getBattleTier(elo);
	const tierIdx = BATTLE_TIERS.indexOf(tier);
	if (tierIdx >= BATTLE_TIERS.length - 1) return 1.0;

	const nextTier = BATTLE_TIERS[tierIdx + 1];
	const range = nextTier.threshold - tier.threshold;
	if (range <= 0) return 1.0;

	return Math.min(1, (elo - tier.threshold) / range);
}
