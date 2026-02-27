/**
 * Player rating and weighted scoring.
 *
 * - weightedScore = rawScore × (difficulty / BASE_DIFFICULTY)
 * - rawEMA        = EMA of weightedScore
 * - skillLevel    = max(0, round(rawEMA / 5))
 *
 * The skill level is a big friendly integer that grows as you
 * consistently perform well on harder levels.
 */

const BASE_DIFFICULTY = 3.0;

// ─── Weighted Score ───────────────────────────────────────────

/**
 * Compute the difficulty-weighted score.
 * Medium-difficulty levels (~3.0) get a 1× multiplier.
 */
export function computeWeightedScore(rawScore: number, difficulty: number): number {
	const multiplier = difficulty / BASE_DIFFICULTY;
	return Math.round(rawScore * multiplier);
}

// ─── Rating (EMA of Weighted Score) ──────────────────────────

/**
 * Update the player's raw EMA rating.
 *
 * The alpha (learning rate) starts high for fast adaptation on new
 * players and decays as they play more games, stabilising the rating.
 *
 * @param currentRawEMA  Current EMA value (stored in DB as `rating`)
 * @param weightedScore  Weighted score from the game just played
 * @param gamesPlayed    Total games played before this one
 */
export function computeNewRating(
	currentRawEMA: number,
	weightedScore: number,
	gamesPlayed: number
): number {
	const alpha = Math.max(0.15, 0.3 - gamesPlayed * 0.004);
	return currentRawEMA + alpha * (weightedScore - currentRawEMA);
}

// ─── Skill Level ─────────────────────────────────────────────

/**
 * Convert the raw EMA into a display-friendly skill level integer.
 * rawEMA of 5000 → skillLevel 1000, etc.
 */
export function computeSkillLevel(rawEMA: number): number {
	return Math.max(0, Math.round(rawEMA / 5));
}

// ─── Rank Tiers ──────────────────────────────────────────────

export interface SkillTier {
	name: string;
	threshold: number;
	color: string;
}

export const SKILL_TIERS: SkillTier[] = [
	{ name: 'Iron', threshold: 0, color: '#8b8b8b' },
	{ name: 'Bronze', threshold: 500, color: '#b07c4a' },
	{ name: 'Silver', threshold: 1000, color: '#a8b4c4' },
	{ name: 'Gold', threshold: 2000, color: '#eab308' },
	{ name: 'Platinum', threshold: 3000, color: '#2dd4bf' },
	{ name: 'Diamond', threshold: 3500, color: '#38bdf8' },
	{ name: 'Genius', threshold: 4000, color: '#a855f7' }
];

/**
 * Get the tier for a given skill level.
 * Returns the highest tier whose threshold ≤ skillLevel.
 */
export function getSkillTier(skillLevel: number): SkillTier {
	let tier = SKILL_TIERS[0];
	for (const t of SKILL_TIERS) {
		if (skillLevel >= t.threshold) tier = t;
		else break;
	}
	return tier;
}

/**
 * Get progress within the current tier (0–1).
 * Returns 1.0 if already at the highest tier.
 */
export function getTierProgress(skillLevel: number): number {
	const tier = getSkillTier(skillLevel);
	const tierIdx = SKILL_TIERS.indexOf(tier);
	if (tierIdx >= SKILL_TIERS.length - 1) return 1.0;

	const nextTier = SKILL_TIERS[tierIdx + 1];
	const range = nextTier.threshold - tier.threshold;
	if (range <= 0) return 1.0;

	return Math.min(1, (skillLevel - tier.threshold) / range);
}
