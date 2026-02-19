<script lang="ts">
	import type { Level } from '$lib/game/levels';
	import { linspace } from '$lib/game/math';

	interface Props {
		level: Level;
		samples: number[];
		onSampleAdd: (x: number) => void;
	}

	let { level, samples, onSampleAdd }: Props = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let container: HTMLDivElement | undefined = $state();
	let width = $state(800);
	let height = $state(500);

	let viewXMin = $state(0);
	let viewXMax = $state(1);

	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartViewMin = $state(0);
	let panStartViewMax = $state(0);

	let lastPinchDist = $state(0);

	let mouseCanvasX = $state(-1);
	let mouseCanvasY = $state(-1);

	const PADDING = { top: 16, right: 16, bottom: 32, left: 16 };

	const plotWidth = $derived(width - PADDING.left - PADDING.right);
	const plotHeight = $derived(height - PADDING.top - PADDING.bottom);

	function xToCanvas(x: number): number {
		return PADDING.left + ((x - viewXMin) / (viewXMax - viewXMin)) * plotWidth;
	}

	function canvasToX(cx: number): number {
		return viewXMin + ((cx - PADDING.left) / plotWidth) * (viewXMax - viewXMin);
	}

	function yToCanvas(y: number, yMax: number): number {
		return PADDING.top + plotHeight - (y / yMax) * plotHeight;
	}

	function resetView() {
		viewXMin = level.xRange[0];
		viewXMax = level.xRange[1];
	}

	$effect(() => {
		level;
		resetView();
	});

	$effect(() => {
		if (!container) return;
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				width = entry.contentRect.width;
				height = Math.max(280, Math.min(entry.contentRect.width * 0.55, 520));
			}
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	$effect(() => {
		if (!canvas) return;
		void width;
		void height;
		void samples;
		void viewXMin;
		void viewXMax;
		void mouseCanvasX;
		draw();
	});

	function draw() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);

		ctx.clearRect(0, 0, width, height);

		// Background gradient
		const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
		bgGrad.addColorStop(0, '#0d0d24');
		bgGrad.addColorStop(1, '#080816');
		ctx.fillStyle = bgGrad;
		ctx.fillRect(0, 0, width, height);

		// Compute y-axis max from PDF only
		const pdfPoints = linspace(viewXMin, viewXMax, 400);
		const pdfValues = pdfPoints.map((x) => level.pdf(x));
		let yMax = Math.max(...pdfValues) * 1.12;
		if (yMax === 0) yMax = 1;

		drawGrid(ctx, yMax);

		if (samples.length > 0) {
			drawHistogram(ctx, yMax);
		}

		drawPdfCurve(ctx, pdfPoints, pdfValues, yMax);
		drawSampleTicks(ctx, yMax);
		drawAxisLabels(ctx);
		drawCrosshair(ctx, yMax);
	}

	function drawGrid(ctx: CanvasRenderingContext2D, yMax: number) {
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
		ctx.lineWidth = 1;

		const xStep = niceStep(viewXMax - viewXMin, 8);
		const xStart = Math.ceil(viewXMin / xStep) * xStep;
		for (let x = xStart; x <= viewXMax; x += xStep) {
			const cx = xToCanvas(x);
			ctx.beginPath();
			ctx.moveTo(cx, PADDING.top);
			ctx.lineTo(cx, PADDING.top + plotHeight);
			ctx.stroke();
		}

		// x-axis baseline
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
		ctx.lineWidth = 1;
		const axisY = yToCanvas(0, yMax);
		ctx.beginPath();
		ctx.moveTo(PADDING.left, axisY);
		ctx.lineTo(PADDING.left + plotWidth, axisY);
		ctx.stroke();
	}

	function drawPdfCurve(
		ctx: CanvasRenderingContext2D,
		points: number[],
		values: number[],
		yMax: number
	) {
		// Glow layer
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
		ctx.lineWidth = 6;
		for (let i = 0; i < points.length; i++) {
			const cx = xToCanvas(points[i]);
			const cy = yToCanvas(Math.min(values[i], yMax), yMax);
			if (i === 0) ctx.moveTo(cx, cy);
			else ctx.lineTo(cx, cy);
		}
		ctx.stroke();

		// Main curve
		ctx.beginPath();
		ctx.strokeStyle = '#00d4ff';
		ctx.lineWidth = 2.5;
		for (let i = 0; i < points.length; i++) {
			const cx = xToCanvas(points[i]);
			const cy = yToCanvas(Math.min(values[i], yMax), yMax);
			if (i === 0) ctx.moveTo(cx, cy);
			else ctx.lineTo(cx, cy);
		}
		ctx.stroke();

		// Fill under curve
		const lastX = xToCanvas(points[points.length - 1]);
		const firstX = xToCanvas(points[0]);
		const baseY = yToCanvas(0, yMax);
		ctx.lineTo(lastX, baseY);
		ctx.lineTo(firstX, baseY);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, PADDING.top, 0, PADDING.top + plotHeight);
		grad.addColorStop(0, 'rgba(0, 212, 255, 0.12)');
		grad.addColorStop(1, 'rgba(0, 212, 255, 0.0)');
		ctx.fillStyle = grad;
		ctx.fill();
	}

	function drawHistogram(ctx: CanvasRenderingContext2D, yMax: number) {
		const [xMin, xMax] = level.xRange;
		const numBins = level.numBins;
		const binWidth = (xMax - xMin) / numBins;

		const binCounts = new Array(numBins).fill(0);
		for (const s of samples) {
			const idx = Math.floor((s - xMin) / binWidth);
			if (idx >= 0 && idx < numBins) binCounts[idx]++;
		}

		const baseY = yToCanvas(0, yMax);

		for (let i = 0; i < numBins; i++) {
			const density = binCounts[i] / (samples.length * binWidth);
			if (density === 0) continue;

			// Cap histogram bars at yMax so they never fly off screen
			const clampedDensity = Math.min(density, yMax * 0.98);

			const binLeft = xMin + i * binWidth;
			const binRight = binLeft + binWidth;
			const cx1 = xToCanvas(binLeft);
			const cx2 = xToCanvas(binRight);
			const cy = yToCanvas(clampedDensity, yMax);

			// Fill
			const barGrad = ctx.createLinearGradient(0, cy, 0, baseY);
			barGrad.addColorStop(0, 'rgba(255, 140, 50, 0.45)');
			barGrad.addColorStop(1, 'rgba(255, 100, 30, 0.15)');
			ctx.fillStyle = barGrad;
			ctx.fillRect(cx1 + 0.5, cy, cx2 - cx1 - 1, baseY - cy);

			// Top edge highlight
			ctx.strokeStyle = 'rgba(255, 160, 60, 0.7)';
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.moveTo(cx1 + 0.5, cy);
			ctx.lineTo(cx2 - 0.5, cy);
			ctx.stroke();
		}
	}

	function drawSampleTicks(ctx: CanvasRenderingContext2D, yMax: number) {
		const baseY = yToCanvas(0, yMax);

		for (const s of samples) {
			const cx = xToCanvas(s);
			if (cx < PADDING.left || cx > PADDING.left + plotWidth) continue;

			ctx.strokeStyle = 'rgba(255, 140, 50, 0.5)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(cx, baseY);
			ctx.lineTo(cx, baseY + 5);
			ctx.stroke();

			// Dot at sample point
			ctx.fillStyle = 'rgba(255, 140, 50, 0.8)';
			ctx.beginPath();
			ctx.arc(cx, baseY + 1, 1.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawAxisLabels(ctx: CanvasRenderingContext2D) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
		ctx.font = '10px ui-monospace, monospace';
		ctx.textAlign = 'center';

		const xStep = niceStep(viewXMax - viewXMin, 8);
		const xStart = Math.ceil(viewXMin / xStep) * xStep;
		const baseY = PADDING.top + plotHeight + 16;

		for (let x = xStart; x <= viewXMax; x += xStep) {
			const cx = xToCanvas(x);
			const label = Math.abs(x) < 1e-10 ? '0' : x.toFixed(1);
			ctx.fillText(label, cx, baseY);
		}
	}

	function drawCrosshair(ctx: CanvasRenderingContext2D, yMax: number) {
		if (mouseCanvasX < PADDING.left || mouseCanvasX > PADDING.left + plotWidth) return;
		if (mouseCanvasY < PADDING.top || mouseCanvasY > PADDING.top + plotHeight + 10) return;

		const x = canvasToX(mouseCanvasX);
		const pdfY = level.pdf(x);

		// Vertical guide line
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);
		ctx.beginPath();
		ctx.moveTo(mouseCanvasX, PADDING.top);
		ctx.lineTo(mouseCanvasX, PADDING.top + plotHeight);
		ctx.stroke();
		ctx.setLineDash([]);

		// Point on curve
		const cyOnCurve = yToCanvas(Math.min(pdfY, yMax), yMax);
		ctx.fillStyle = '#00d4ff';
		ctx.beginPath();
		ctx.arc(mouseCanvasX, cyOnCurve, 4, 0, Math.PI * 2);
		ctx.fill();

		// Crosshair dot at click position
		ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
		ctx.beginPath();
		ctx.arc(mouseCanvasX, PADDING.top + plotHeight, 3, 0, Math.PI * 2);
		ctx.fill();
	}

	function niceStep(range: number, maxTicks: number): number {
		const rough = range / maxTicks;
		const mag = Math.pow(10, Math.floor(Math.log10(rough)));
		const norm = rough / mag;
		let step: number;
		if (norm < 1.5) step = 1;
		else if (norm < 3) step = 2;
		else if (norm < 7) step = 5;
		else step = 10;
		return step * mag;
	}

	function handleClick(e: MouseEvent) {
		if (isPanning) return;
		const rect = canvas!.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;

		if (cy < PADDING.top - 10 || cy > PADDING.top + plotHeight + 15) return;
		if (cx < PADDING.left || cx > PADDING.left + plotWidth) return;

		const x = canvasToX(cx);
		onSampleAdd(x);
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = canvas!.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const mouseX = canvasToX(cx);

		const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
		const newMin = mouseX - (mouseX - viewXMin) * zoomFactor;
		const newMax = mouseX + (viewXMax - mouseX) * zoomFactor;

		const minRange = 0.5;
		const maxRange = (level.xRange[1] - level.xRange[0]) * 3;
		if (newMax - newMin >= minRange && newMax - newMin <= maxRange) {
			viewXMin = newMin;
			viewXMax = newMax;
		}
	}

	function handleMouseDown(e: MouseEvent) {
		if (e.button === 1 || e.button === 2 || e.shiftKey) {
			e.preventDefault();
			isPanning = true;
			panStartX = e.clientX;
			panStartViewMin = viewXMin;
			panStartViewMax = viewXMax;
		}
	}

	function handleMouseMove(e: MouseEvent) {
		const rect = canvas!.getBoundingClientRect();
		mouseCanvasX = e.clientX - rect.left;
		mouseCanvasY = e.clientY - rect.top;

		if (!isPanning) return;
		const dx = e.clientX - panStartX;
		const xPerPixel = (panStartViewMax - panStartViewMin) / plotWidth;
		const shift = -dx * xPerPixel;
		viewXMin = panStartViewMin + shift;
		viewXMax = panStartViewMax + shift;
	}

	function handleMouseLeave() {
		isPanning = false;
		mouseCanvasX = -1;
		mouseCanvasY = -1;
	}

	function handleMouseUp() {
		isPanning = false;
	}

	function handleTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			const dx = e.touches[0].clientX - e.touches[1].clientX;
			const dy = e.touches[0].clientY - e.touches[1].clientY;
			lastPinchDist = Math.sqrt(dx * dx + dy * dy);
			panStartViewMin = viewXMin;
			panStartViewMax = viewXMax;
		}
	}

	function handleTouchMove(e: TouchEvent) {
		if (e.touches.length === 2) {
			e.preventDefault();
			const dx = e.touches[0].clientX - e.touches[1].clientX;
			const dy = e.touches[0].clientY - e.touches[1].clientY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			const scale = lastPinchDist / dist;

			const midScreenX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			const rect = canvas!.getBoundingClientRect();
			const midX = canvasToX(midScreenX - rect.left);

			const newRange = (panStartViewMax - panStartViewMin) * scale;
			const minRange = 0.5;
			const maxRange = (level.xRange[1] - level.xRange[0]) * 3;
			if (newRange >= minRange && newRange <= maxRange) {
				const ratio = (midX - panStartViewMin) / (panStartViewMax - panStartViewMin);
				viewXMin = midX - ratio * newRange;
				viewXMax = midX + (1 - ratio) * newRange;
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length < 2) {
			lastPinchDist = 0;
		}

		if (e.changedTouches.length === 1 && e.touches.length === 0 && lastPinchDist === 0) {
			const touch = e.changedTouches[0];
			const rect = canvas!.getBoundingClientRect();
			const cx = touch.clientX - rect.left;
			const cy = touch.clientY - rect.top;

			if (cy >= PADDING.top - 10 && cy <= PADDING.top + plotHeight + 15) {
				if (cx >= PADDING.left && cx <= PADDING.left + plotWidth) {
					const x = canvasToX(cx);
					onSampleAdd(x);
				}
			}
		}
	}

	export function zoomIn() {
		const mid = (viewXMin + viewXMax) / 2;
		const range = (viewXMax - viewXMin) * 0.8;
		viewXMin = mid - range / 2;
		viewXMax = mid + range / 2;
	}

	export function zoomOut() {
		const mid = (viewXMin + viewXMax) / 2;
		const range = (viewXMax - viewXMin) * 1.25;
		const maxRange = (level.xRange[1] - level.xRange[0]) * 3;
		if (range <= maxRange) {
			viewXMin = mid - range / 2;
			viewXMax = mid + range / 2;
		}
	}
</script>

<div bind:this={container} class="relative w-full">
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {height}px; cursor: none;"
		class="block rounded-lg"
		aria-label="Click on the chart to place samples"
		onclick={handleClick}
		onwheel={handleWheel}
		onmousedown={handleMouseDown}
		onmousemove={handleMouseMove}
		onmouseup={handleMouseUp}
		onmouseleave={handleMouseLeave}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>

	<div class="absolute right-3 top-3 flex flex-col gap-1">
		<button
			onclick={zoomIn}
			class="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-xs text-white/50 transition hover:bg-white/15 hover:text-white/80"
			aria-label="Zoom in"
		>
			+
		</button>
		<button
			onclick={zoomOut}
			class="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-xs text-white/50 transition hover:bg-white/15 hover:text-white/80"
			aria-label="Zoom out"
		>
			-
		</button>
		<button
			onclick={resetView}
			class="flex h-7 w-7 items-center justify-center rounded bg-white/5 text-[9px] text-white/50 transition hover:bg-white/15 hover:text-white/80"
			aria-label="Reset zoom"
		>
			R
		</button>
	</div>
</div>
