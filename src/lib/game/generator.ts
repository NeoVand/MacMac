/**
 * Procedural level generation.
 *
 * Parameter-driven: difficulty directly controls generation parameters
 * via deterministic mappings. No accept/reject loop needed — the
 * structural properties are guaranteed by the parameter choices.
 * The PRNG only randomizes specific positions.
 */
import { SeededRandom } from './random';
import { kernelTargetPdf, type Level, type DifficultyLabel } from './levels';
import { difficultyToLabel } from './difficulty';
import { clamp } from './math';

export interface GeneratedLevel extends Level {
	seed: number;
	hiddenClicks: number[];
	targetDifficulty: number;
	numModes: number;
}

/**
 * Deterministic parameter mappings from target difficulty d ∈ [1, 10].
 */
function numModes(d: number): number {
	return clamp(Math.round(0.5 + d * 0.65), 1, 7);
}

function totalClicks(d: number): number {
	return clamp(Math.round(2 + d * 4.3), 3, 45);
}

function minSeparation(d: number): number {
	return 2.2 - d * 0.14;
}

function heightVariance(d: number): number {
	return d * 0.07;
}

function noiseRatio(d: number): number {
	return Math.max(0, (d - 4) * 0.03);
}

/**
 * Generate a level from a seed and target difficulty.
 *
 * The seed fully determines the level — same seed + same difficulty
 * always produces the identical hiddenClicks array. This lets the
 * server reproduce any client-generated level for score verification.
 */
export function generateLevel(seed: number, targetDifficulty: number): GeneratedLevel {
	const d = clamp(targetDifficulty, 1, 10);
	const rng = new SeededRandom(seed);

	const nModes = numModes(d);
	const nClicks = totalClicks(d);
	const minSep = minSeparation(d);
	const hVar = heightVariance(d);
	const noise = noiseRatio(d);

	// 1. Place mode centers with minimum separation
	const centers: number[] = [];
	centers.push(rng.range(-2, 2));

	for (let m = 1; m < nModes; m++) {
		const spread = 3 + nModes * 0.5;
		let center: number;
		let attempts = 0;
		do {
			center = rng.range(centers[0] - spread, centers[0] + spread);
			attempts++;
		} while (attempts < 50 && centers.some((c) => Math.abs(c - center) < minSep));
		centers.push(center);
	}
	centers.sort((a, b) => a - b);

	// 2. Distribute clicks across modes (unequal weights for harder levels)
	const weights = centers.map(() => Math.max(0.1, rng.range(1 - hVar, 1 + hVar)));
	const weightSum = weights.reduce((a, b) => a + b, 0);

	const mainClicks = Math.max(nClicks - Math.floor(noise * nClicks), nModes);
	const clicksPerMode = weights.map((w) => Math.max(1, Math.round((mainClicks * w) / weightSum)));

	// Adjust total to match target
	let currentTotal = clicksPerMode.reduce((a, b) => a + b, 0);
	while (currentTotal < mainClicks) {
		const idx = rng.int(0, clicksPerMode.length - 1);
		clicksPerMode[idx]++;
		currentTotal++;
	}
	while (currentTotal > mainClicks) {
		const idx = rng.int(0, clicksPerMode.length - 1);
		if (clicksPerMode[idx] > 1) {
			clicksPerMode[idx]--;
			currentTotal--;
		}
	}

	// 3. Scatter clicks around each mode center
	const hiddenClicks: number[] = [];
	for (let m = 0; m < nModes; m++) {
		const sigma = 0.2 + rng.next() * 0.3;
		for (let j = 0; j < clicksPerMode[m]; j++) {
			hiddenClicks.push(centers[m] + rng.gaussian(0, sigma));
		}
	}

	// 4. Add noise clicks (for harder levels)
	const noiseCount = Math.floor(noise * nClicks);
	if (noiseCount > 0) {
		const rangeMin = Math.min(...hiddenClicks) - 1;
		const rangeMax = Math.max(...hiddenClicks) + 1;
		for (let i = 0; i < noiseCount; i++) {
			hiddenClicks.push(rng.range(rangeMin, rangeMax));
		}
	}

	// 5. Snap to 2 decimal places (matching the game's sample precision)
	for (let i = 0; i < hiddenClicks.length; i++) {
		hiddenClicks[i] = Math.round(hiddenClicks[i] * 100) / 100;
	}

	// 6. Compute derived properties
	const extent = Math.max(...hiddenClicks) - Math.min(...hiddenClicks);
	const padding = Math.max(2.5, extent * 0.2);
	const xMin = Math.floor((Math.min(...hiddenClicks) - padding) * 2) / 2;
	const xMax = Math.ceil((Math.max(...hiddenClicks) + padding) * 2) / 2;
	const xRange: [number, number] = [xMin, xMax];

	const pdf = kernelTargetPdf(hiddenClicks);
	const diffLabel = difficultyToLabel(d);
	const numBins = 35 + Math.round(d * 2.5);

	return {
		id: `g-${seed.toString(36)}-${Math.round(d * 10)}`,
		name: `${nModes === 1 ? 'Single Peak' : nModes === 2 ? 'Twin Peaks' : nModes + ' Modes'}`,
		subtitle: `${hiddenClicks.length} samples`,
		difficulty: diffLabel,
		difficultyScore: d,
		pdf,
		xRange,
		numBins,
		seed,
		hiddenClicks,
		targetDifficulty: d,
		numModes: nModes
	};
}

/**
 * Reconstruct a level from just its seed and difficulty.
 * Used by the server for score verification — deterministic.
 */
export function reconstructLevel(seed: number, targetDifficulty: number): GeneratedLevel {
	return generateLevel(seed, targetDifficulty);
}

/**
 * Parse a generated level ID like "g-abc123-45" into seed and difficulty.
 * Returns null for legacy numeric IDs.
 */
export function parseGeneratedId(id: string): { seed: number; targetDifficulty: number } | null {
	const match = id.match(/^g-([a-z0-9]+)-(\d+)$/);
	if (!match) return null;
	return {
		seed: parseInt(match[1], 36),
		targetDifficulty: parseInt(match[2], 10) / 10
	};
}
