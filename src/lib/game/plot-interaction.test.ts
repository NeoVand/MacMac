import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canvasPoint,
	isPlotTap,
	moveSampleX,
	normalizeShape,
	plotSampleX,
	snapSampleX
} from './plot-interaction.ts';

const size = { width: 800, height: 500 };
const padding = { left: 30, right: 30 };
const range = [-4, 4] as const;

test('clicking a peak, the middle or the baseline places the same sample', () => {
	for (const y of [0, 30, 90, 250, 456, 500])
		assert.equal(plotSampleX({ x: 585, y }, size, range, padding), 2);
});

test('CSS scaling and high-density displays preserve horizontal sample positions', () => {
	const rect = { left: 100, top: 50, width: 400, height: 250 };
	const point = canvasPoint(392.5, 95, rect, size);
	assert.deepEqual(point, { x: 585, y: 90 });
	assert.equal(plotSampleX(point!, size, range, padding), 2);
	assert.deepEqual(canvasPoint(100, 50, rect, size), { x: 0, y: 0 });
});

test('chart bounds accept endpoints and reject outside clicks or unmeasured canvases', () => {
	assert.equal(plotSampleX({ x: 30, y: 100 }, size, range, padding), -4);
	assert.equal(plotSampleX({ x: 770, y: 100 }, size, range, padding), 4);
	for (const point of [
		{ x: 29, y: 50 },
		{ x: 771, y: 50 },
		{ x: 400, y: -1 },
		{ x: 400, y: 501 },
		{ x: NaN, y: 50 }
	])
		assert.equal(plotSampleX(point, size, range, padding), null);
	assert.equal(canvasPoint(20, 20, { left: 0, top: 0, width: 0, height: 0 }, size), null);
	assert.equal(plotSampleX({ x: 30, y: 0 }, { width: 40, height: 0 }, range, padding), null);
});

test('sample precision never rounds a value beyond a fractional range endpoint', () => {
	assert.equal(snapSampleX(-1.234, range), -1.23);
	assert.equal(snapSampleX(-10, range), -4);
	assert.equal(snapSampleX(10, range), 4);
	assert.equal(snapSampleX(1.999, [0.003, 1.999]), 1.999);
	assert.equal(snapSampleX(0.003, [0.003, 1.999]), 0.003);
});

test('keyboard placement moves, accelerates and reaches either endpoint without escaping', () => {
	assert.equal(moveSampleX(0, 'ArrowRight', range), 0.08);
	assert.equal(moveSampleX(0, 'ArrowLeft', range, true), -0.4);
	assert.equal(moveSampleX(3.99, 'ArrowUp', range), 4);
	assert.equal(moveSampleX(-3.99, 'ArrowDown', range), -4);
	assert.equal(moveSampleX(0, 'Home', range), -4);
	assert.equal(moveSampleX(0, 'End', range), 4);
	assert.equal(moveSampleX(0, 'Tab', range), null);
});

test('touch tolerance accepts taps while rejecting scrolling and dragging', () => {
	assert.equal(isPlotTap({ x: 100, y: 100 }, { x: 104, y: 103 }), true);
	assert.equal(isPlotTap({ x: 100, y: 100 }, { x: 100, y: 130 }), false);
	assert.equal(isPlotTap({ x: 100, y: 100 }, { x: 150, y: 100 }), false);
});

test('display compares shape independently of density amplitude, like the scoring formula', () => {
	assert.deepEqual(normalizeShape([0, 2, 4, 2]), normalizeShape([0, 20, 40, 20]));
	assert.deepEqual(normalizeShape([0, 0, 0]), [0, 0, 0]);
	assert.deepEqual(normalizeShape([]), []);
	assert.deepEqual(normalizeShape([NaN, Infinity, -1, 2]), [0, 0, 0, 1]);
});
