/**
 * Grid generation for the home page.
 *
 * Generates a set of levels with difficulties spread around
 * the player's rating. Each page load creates a fresh grid.
 * Completed levels get replaced with new ones.
 */
import { SeededRandom } from './random';
import { generateLevel, type GeneratedLevel } from './generator';
import { linspace, clamp } from './math';
import { computeSkillLevel } from './rating';

export interface GridConfig {
	total: number;
	difficultyCenter: number;
	difficultySpread: number;
}

const DEFAULT_CONFIG: GridConfig = {
	total: 12,
	difficultyCenter: 4.0,
	difficultySpread: 3.5
};

/**
 * Generate a full grid of levels.
 *
 * Difficulty targets are spread across the range, then slightly
 * shuffled so the grid doesn't show a perfect easy-to-hard order.
 */
export function generateGrid(
	baseSeed: number,
	config: Partial<GridConfig> = {}
): GeneratedLevel[] {
	const { total, difficultyCenter, difficultySpread } = { ...DEFAULT_CONFIG, ...config };

	const minDiff = Math.max(1, difficultyCenter - difficultySpread);
	const maxDiff = Math.min(10, difficultyCenter + difficultySpread);
	const targets = linspace(minDiff, maxDiff, total);

	// Partial shuffle: swap with nearby elements for visual variety
	const rng = new SeededRandom(baseSeed);
	for (let i = targets.length - 1; i > 0; i--) {
		const j = Math.max(0, i - rng.int(0, 2));
		[targets[i], targets[j]] = [targets[j], targets[i]];
	}

	const levels: GeneratedLevel[] = [];
	for (let i = 0; i < total; i++) {
		const seed = deriveSeed(baseSeed, i);
		// Round to 1 decimal so it encodes losslessly in the URL
		const roundedDiff = Math.round(targets[i] * 10) / 10;
		levels.push(generateLevel(seed, roundedDiff));
	}

	return levels;
}

/**
 * Generate a single replacement level for a completed slot.
 * Uses a new random seed and a difficulty near the player's rating.
 */
export function generateReplacement(
	playerRating: number,
	slotIndex: number
): GeneratedLevel {
	const seed = Math.floor(Date.now() / 1000) * 100 + slotIndex;
	const rng = new SeededRandom(seed);
	const center = ratingToDifficultyCenter(playerRating);
	const difficulty = Math.round(clamp(center + rng.range(-2, 2), 1, 10) * 10) / 10;
	return generateLevel(seed, difficulty);
}

/**
 * Derive a deterministic sub-seed from a base seed and an index.
 */
function deriveSeed(baseSeed: number, index: number): number {
	let hash = baseSeed;
	hash = ((hash << 5) - hash + index) | 0;
	hash = ((hash << 13) ^ hash) | 0;
	return hash >>> 0; // ensure positive
}

/**
 * Convert a raw EMA rating to a difficulty center for grid generation.
 *
 * Skill 0     → diff ~3 (beginner)
 * Skill 2000  → diff ~5
 * Skill 4000+ → diff ~8
 *
 * Uses a smooth linear interpolation from the skill level.
 */
function ratingToDifficultyCenter(rawEMA: number): number {
	const skill = computeSkillLevel(rawEMA);
	// Map skill 0→3, 2000→5, 4000→8
	const diff = 3 + (skill / 4000) * 5;
	return clamp(diff, 2, 8);
}

/**
 * Get the grid config centered on a player's rating.
 */
export function gridConfigForRating(rating: number | null): Partial<GridConfig> {
	if (rating === null || rating <= 0) {
		return DEFAULT_CONFIG;
	}
	return {
		total: 12,
		difficultyCenter: ratingToDifficultyCenter(rating),
		difficultySpread: 2.5
	};
}
