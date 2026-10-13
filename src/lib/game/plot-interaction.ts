export interface PlotPoint {
	x: number;
	y: number;
}

export interface PlotSize {
	width: number;
	height: number;
}

export interface PlotRect extends PlotSize {
	left: number;
	top: number;
}

export const SAMPLE_DECIMALS = 2;

/** Convert CSS client coordinates to the canvas's logical drawing coordinates. */
export function canvasPoint(
	clientX: number,
	clientY: number,
	rect: PlotRect,
	size: PlotSize
): PlotPoint | null {
	if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return null;
	const x = ((clientX - rect.left) / rect.width) * size.width;
	const y = ((clientY - rect.top) / rect.height) * size.height;
	return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function snapSampleX(x: number, range: readonly [number, number]): number {
	const scale = 10 ** SAMPLE_DECIMALS;
	const clamped = Math.max(range[0], Math.min(range[1], x));
	const rounded = Math.round((clamped + Number.EPSILON) * scale) / scale;
	return Math.max(range[0], Math.min(range[1], rounded));
}

/** Height never changes a sample: the entire chart accepts the same horizontal position. */
export function plotSampleX(
	point: PlotPoint,
	size: PlotSize,
	range: readonly [number, number],
	padding: { left: number; right: number }
): number | null {
	const plotWidth = size.width - padding.left - padding.right;
	if (
		plotWidth <= 0 ||
		!Number.isFinite(point.x) ||
		!Number.isFinite(point.y) ||
		point.x < padding.left ||
		point.x > size.width - padding.right ||
		point.y < 0 ||
		point.y > size.height
	)
		return null;
	return snapSampleX(
		range[0] + ((point.x - padding.left) / plotWidth) * (range[1] - range[0]),
		range
	);
}

export function moveSampleX(
	current: number,
	key: string,
	range: readonly [number, number],
	fast = false
): number | null {
	const step = Math.max(0.01, (range[1] - range[0]) / (fast ? 20 : 100));
	if (key === 'Home') return snapSampleX(range[0], range);
	if (key === 'End') return snapSampleX(range[1], range);
	if (key === 'ArrowLeft' || key === 'ArrowDown') return snapSampleX(current - step, range);
	if (key === 'ArrowRight' || key === 'ArrowUp') return snapSampleX(current + step, range);
	return null;
}

/** A scroll, drag or pinch must not accidentally spend a sample. */
export function isPlotTap(start: PlotPoint, end: PlotPoint): boolean {
	return Math.hypot(end.x - start.x, end.y - start.y) <= 12;
}

/** The displayed curves use the same peak normalization as the shape-match score. */
export function normalizeShape(values: readonly number[]): number[] {
	const safe = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
	const peak = Math.max(0, ...safe);
	return peak > 0 ? safe.map((value) => value / peak) : safe;
}
