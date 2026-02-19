import type { Level } from './levels';
import { linspace } from './math';
import { computeKDE } from './kde';

export interface ScoreResult {
	kl: number;
	clicks: number;
	score: number;
	accuracyPct: number;
	histogramData: { binCenter: number; empirical: number; theoretical: number }[];
}

const KL_BINS = 40;
const KL_EPSILON = 1e-10;

/**
 * Compute KL divergence KL(P_true || Q_kde) using the KDE as the empirical distribution.
 * This ensures the score matches the visual — if the KDE curve looks close
 * to the PDF, the KL will be low.
 */
export function computeKL(
	samples: number[],
	level: Level
): { kl: number; histogramData: ScoreResult['histogramData'] } {
	const [xMin, xMax] = level.xRange;

	const binCenters = linspace(xMin, xMax, KL_BINS + 1)
		.slice(0, KL_BINS)
		.map((x, i) => x + (xMax - xMin) / (2 * KL_BINS));

	// Evaluate true PDF and KDE at bin centers
	const pVals = binCenters.map((x) => level.pdf(x));
	const qVals = computeKDE(samples, binCenters);

	// Normalize both to sum to 1 (discrete probability distributions)
	const pSum = pVals.reduce((a, b) => a + b, 0);
	const qSum = qVals.reduce((a, b) => a + b, 0);

	let kl = 0;
	for (let i = 0; i < KL_BINS; i++) {
		const p = pSum > 0 ? pVals[i] / pSum : 0;
		const q = qSum > 0 ? qVals[i] / qSum : 1 / KL_BINS;
		if (p > KL_EPSILON && q > KL_EPSILON) {
			kl += p * Math.log(p / q);
		}
	}
	kl = Math.max(0, kl);

	// Histogram data for display
	const displayBins = level.numBins;
	const displayCenters = linspace(xMin, xMax, displayBins + 1)
		.slice(0, displayBins)
		.map((x) => x + (xMax - xMin) / (2 * displayBins));

	const histogramData: ScoreResult['histogramData'] = displayCenters.map((x) => ({
		binCenter: x,
		empirical: 0,
		theoretical: level.pdf(x)
	}));

	return { kl, histogramData };
}

/**
 * Score = floor(10000 / ((1 + 10*KL) * (1 + clicks/100)))
 */
export function computeScore(kl: number, clicks: number): number {
	return Math.floor(10000 / ((1 + 10 * kl) * (1 + clicks / 100)));
}

export function getFullScore(samples: number[], level: Level): ScoreResult {
	if (samples.length === 0) {
		return { kl: Infinity, clicks: 0, score: 0, accuracyPct: 0, histogramData: [] };
	}

	const { kl, histogramData } = computeKL(samples, level);
	const clicks = samples.length;
	const score = computeScore(kl, clicks);
	const accuracyPct = Math.round((1 / (1 + 10 * kl)) * 100);

	return { kl, clicks, score, accuracyPct, histogramData };
}

export function getDifficultyColor(difficulty: Level['difficulty']): string {
	switch (difficulty) {
		case 'easy':
			return '#4ade80';
		case 'medium':
			return '#facc15';
		case 'hard':
			return '#f97316';
		case 'expert':
			return '#ef4444';
	}
}
