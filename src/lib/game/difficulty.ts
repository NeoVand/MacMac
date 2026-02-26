/**
 * Difficulty utilities for generated distributions.
 *
 * The targetDifficulty (1–10) set during generation IS the difficulty.
 * It directly controls level complexity via deterministic parameter
 * mappings (numModes, totalClicks, minSeparation, etc.).
 */
import type { DifficultyLabel } from './levels';

/**
 * Map a continuous difficulty score to a label.
 */
export function difficultyToLabel(d: number): DifficultyLabel {
	if (d < 3) return 'easy';
	if (d < 5.5) return 'medium';
	if (d < 7.5) return 'hard';
	return 'expert';
}

/**
 * Difficulty-to-color mapping (same colors as existing getDifficultyColor).
 */
export function difficultyColor(d: number): string {
	if (d < 3) return '#4ade80';
	if (d < 5.5) return '#facc15';
	if (d < 7.5) return '#f97316';
	return '#ef4444';
}
