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
 * Difficulty-to-color mapping using theme-aware CSS variables.
 * Returns a CSS var() reference that adapts to light/dark mode.
 */
export function difficultyColor(d: number): string {
	if (d < 3) return 'var(--diff-easy)';
	if (d < 5.5) return 'var(--diff-medium)';
	if (d < 7.5) return 'var(--diff-hard)';
	return 'var(--diff-expert)';
}
