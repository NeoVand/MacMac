import type { Level } from './levels';
import { linspace } from './math';
import { computeKDE } from './kde';

export interface ScoreResult {
	mse: number;
	clicks: number;
	score: number;
	matchPct: number;
	matchScore: number;
	timeBonus: number;
	histogramData: { binCenter: number; empirical: number; theoretical: number }[];
}

const EVAL_POINTS = 200;
const MATCH_MAX = 8000;
const MATCH_SENSITIVITY = 100;
const TIME_MAX = 2000;
const TIME_LIMIT_MS = 60_000;

/**
 * Compute Mean Squared Error between peak-normalized PDF and KDE.
 * Both curves are scaled so their maximum = 1, then compared point-by-point.
 * This measures visual shape similarity — if the curves look the same, MSE is low.
 */
export function computeShapeMatch(
	samples: number[],
	level: Level
): { mse: number; histogramData: ScoreResult['histogramData'] } {
	const [xMin, xMax] = level.xRange;
	const xs = linspace(xMin, xMax, EVAL_POINTS);

	const pVals = xs.map((x) => level.pdf(x));
	const qVals = computeKDE(samples, xs);

	const pMax = Math.max(...pVals);
	const qMax = Math.max(...qVals);

	let mse = 0;
	for (let i = 0; i < EVAL_POINTS; i++) {
		const p = pMax > 0 ? pVals[i] / pMax : 0;
		const q = qMax > 0 ? qVals[i] / qMax : 0;
		mse += (p - q) ** 2;
	}
	mse /= EVAL_POINTS;

	const displayBins = level.numBins;
	const displayCenters = linspace(xMin, xMax, displayBins + 1)
		.slice(0, displayBins)
		.map((x) => x + (xMax - xMin) / (2 * displayBins));

	const histogramData: ScoreResult['histogramData'] = displayCenters.map((x) => ({
		binCenter: x,
		empirical: 0,
		theoretical: level.pdf(x)
	}));

	return { mse, histogramData };
}

/**
 * Shape Match score: 8000 / (1 + 100 * MSE)
 * MSE=0 → 8000, MSE=0.01 → 4444, MSE=0.1 → 727
 */
export function computeMatchScore(mse: number): number {
	return Math.round(MATCH_MAX / (1 + MATCH_SENSITIVITY * mse));
}

/**
 * Time Bonus: linear decay from 2000 to 0 over 60 seconds.
 * Instant → 2000, 30s → 1000, 60s → 0
 */
export function computeTimeBonus(elapsedMs: number): number {
	const safeElapsedMs = Math.max(0, elapsedMs);
	const remaining = Math.max(0, 1 - safeElapsedMs / TIME_LIMIT_MS);
	return Math.round(TIME_MAX * remaining);
}

/**
 * Total Score = Match Score + Time Bonus
 * No explicit click penalty — time naturally penalizes more clicks.
 */
export function computeScore(mse: number, elapsedMs: number): number {
	return computeMatchScore(mse) + computeTimeBonus(elapsedMs);
}

export function getFullScore(samples: number[], level: Level, elapsedMs: number = 0): ScoreResult {
	if (samples.length === 0) {
		return { mse: 1, clicks: 0, score: 0, matchPct: 0, matchScore: 0, timeBonus: 0, histogramData: [] };
	}

	const { mse, histogramData } = computeShapeMatch(samples, level);
	const clicks = samples.length;
	const matchScore = computeMatchScore(mse);
	const timeBonus = computeTimeBonus(elapsedMs);
	const score = matchScore + timeBonus;
	const matchPct = Math.round((1 / (1 + MATCH_SENSITIVITY * mse)) * 100);

	return { mse, clicks, score, matchPct, matchScore, timeBonus, histogramData };
}

export function getDifficultyColor(difficulty: Level['difficulty']): string {
	switch (difficulty) {
		case 'easy':
			return 'var(--diff-easy)';
		case 'medium':
			return 'var(--diff-medium)';
		case 'hard':
			return 'var(--diff-hard)';
		case 'expert':
			return 'var(--diff-expert)';
	}
}
