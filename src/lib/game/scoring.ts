import type { Level } from './levels';
import { linspace } from './math';

export interface ScoreResult {
	kl: number;
	clicks: number;
	score: number;
	accuracyPct: number;
	histogramData: { binCenter: number; empirical: number; theoretical: number }[];
}

const KL_BINS = 20;
const KL_EPSILON = 0.1;

/**
 * Compute KL divergence KL(P_true || Q_empirical) using binned distributions.
 */
export function computeKL(
	samples: number[],
	level: Level
): { kl: number; histogramData: ScoreResult['histogramData'] } {
	const [xMin, xMax] = level.xRange;
	const n = samples.length;

	const klBinWidth = (xMax - xMin) / KL_BINS;
	const klBinCounts = new Array(KL_BINS).fill(0);
	for (const s of samples) {
		const idx = Math.floor((s - xMin) / klBinWidth);
		if (idx >= 0 && idx < KL_BINS) klBinCounts[idx]++;
	}

	const totalSmoothed = n + KL_BINS * KL_EPSILON;
	const klTruePdf = linspace(xMin + klBinWidth / 2, xMax - klBinWidth / 2, KL_BINS).map((x) =>
		level.pdf(x)
	);
	const klTrueSum = klTruePdf.reduce((a, b) => a + b, 0);

	let kl = 0;
	for (let i = 0; i < KL_BINS; i++) {
		const p = klTruePdf[i] / klTrueSum;
		const q = (klBinCounts[i] + KL_EPSILON) / totalSmoothed;
		if (p > 1e-10) {
			kl += p * Math.log(p / q);
		}
	}
	kl = Math.max(0, kl);

	const displayBins = level.numBins;
	const displayBinWidth = (xMax - xMin) / displayBins;
	const displayCounts = new Array(displayBins).fill(0);
	for (const s of samples) {
		const idx = Math.floor((s - xMin) / displayBinWidth);
		if (idx >= 0 && idx < displayBins) displayCounts[idx]++;
	}

	const histogramData: ScoreResult['histogramData'] = [];
	for (let i = 0; i < displayBins; i++) {
		const binCenter = xMin + (i + 0.5) * displayBinWidth;
		histogramData.push({
			binCenter,
			empirical: displayCounts[i] / (n * displayBinWidth || 1),
			theoretical: level.pdf(binCenter)
		});
	}

	return { kl, histogramData };
}

/**
 * Score = floor(10000 / ((1 + 10*KL) * (1 + clicks/100)))
 *
 * Multiplicative: bad accuracy can't be rescued by few clicks.
 * KL dominates. Clicks add a mild penalty with diminishing returns.
 * No level-specific parameters.
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
