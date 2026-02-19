<script lang="ts">
	import type { Level } from '$lib/game/levels';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';

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

	let mouseX = $state(-1);
	let mouseY = $state(-1);

	const PAD = { top: 24, right: 24, bottom: 40, left: 24 };

	const pw = $derived(width - PAD.left - PAD.right);
	const ph = $derived(height - PAD.top - PAD.bottom);

	function toScreenX(x: number): number {
		return PAD.left + ((x - viewXMin) / (viewXMax - viewXMin)) * pw;
	}
	function toDataX(sx: number): number {
		return viewXMin + ((sx - PAD.left) / pw) * (viewXMax - viewXMin);
	}
	function toScreenY(y: number, yMax: number): number {
		return PAD.top + ph - (y / yMax) * ph;
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
			const e = entries[0];
			if (e) {
				width = e.contentRect.width;
				height = e.contentRect.height;
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
		void mouseX;
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

		// Background
		const bg = ctx.createRadialGradient(width / 2, height * 0.3, 0, width / 2, height * 0.3, width);
		bg.addColorStop(0, '#111133');
		bg.addColorStop(1, '#080816');
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, width, height);

		// PDF evaluation
		const nPts = 500;
		const xs = linspace(viewXMin, viewXMax, nPts);
		const pdfVals = xs.map((x) => level.pdf(x));
		let yMax = Math.max(...pdfVals) * 1.15;
		if (yMax <= 0) yMax = 1;

		const baseY = toScreenY(0, yMax);

		drawGrid(ctx, yMax, baseY);

		// KDE from samples
		if (samples.length >= 2) {
			drawKDE(ctx, xs, yMax, baseY);
		}

		drawPDF(ctx, xs, pdfVals, yMax, baseY);
		drawSamples(ctx, baseY);
		drawAxisLabels(ctx, baseY);
		drawCrosshair(ctx, yMax, baseY);
	}

	function drawGrid(ctx: CanvasRenderingContext2D, yMax: number, baseY: number) {
		const xStep = niceStep(viewXMax - viewXMin, 8);
		const xStart = Math.ceil(viewXMin / xStep) * xStep;

		ctx.strokeStyle = 'rgba(255,255,255,0.03)';
		ctx.lineWidth = 1;
		for (let x = xStart; x <= viewXMax; x += xStep) {
			const sx = toScreenX(x);
			ctx.beginPath();
			ctx.moveTo(sx, PAD.top);
			ctx.lineTo(sx, baseY);
			ctx.stroke();
		}

		// x-axis
		ctx.strokeStyle = 'rgba(255,255,255,0.08)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(PAD.left, baseY);
		ctx.lineTo(PAD.left + pw, baseY);
		ctx.stroke();
	}

	function drawPDF(
		ctx: CanvasRenderingContext2D,
		xs: number[],
		vals: number[],
		yMax: number,
		baseY: number
	) {
		// Glow
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(0, 200, 255, 0.15)';
		ctx.lineWidth = 10;
		for (let i = 0; i < xs.length; i++) {
			const sx = toScreenX(xs[i]);
			const sy = toScreenY(vals[i], yMax);
			if (i === 0) ctx.moveTo(sx, sy);
			else ctx.lineTo(sx, sy);
		}
		ctx.stroke();

		// Main curve
		ctx.beginPath();
		ctx.strokeStyle = '#00ccff';
		ctx.lineWidth = 3;
		for (let i = 0; i < xs.length; i++) {
			const sx = toScreenX(xs[i]);
			const sy = toScreenY(vals[i], yMax);
			if (i === 0) ctx.moveTo(sx, sy);
			else ctx.lineTo(sx, sy);
		}
		ctx.stroke();

		// Fill
		ctx.lineTo(toScreenX(xs[xs.length - 1]), baseY);
		ctx.lineTo(toScreenX(xs[0]), baseY);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, PAD.top, 0, baseY);
		grad.addColorStop(0, 'rgba(0, 200, 255, 0.08)');
		grad.addColorStop(1, 'rgba(0, 200, 255, 0.0)');
		ctx.fillStyle = grad;
		ctx.fill();
	}

	function drawKDE(
		ctx: CanvasRenderingContext2D,
		xs: number[],
		yMax: number,
		baseY: number
	) {
		const kdeVals = computeKDE(samples, xs);

		// Filled area
		ctx.beginPath();
		for (let i = 0; i < xs.length; i++) {
			const sx = toScreenX(xs[i]);
			const sy = toScreenY(Math.min(kdeVals[i], yMax * 0.98), yMax);
			if (i === 0) ctx.moveTo(sx, sy);
			else ctx.lineTo(sx, sy);
		}
		ctx.lineTo(toScreenX(xs[xs.length - 1]), baseY);
		ctx.lineTo(toScreenX(xs[0]), baseY);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, PAD.top, 0, baseY);
		grad.addColorStop(0, 'rgba(255, 130, 40, 0.25)');
		grad.addColorStop(1, 'rgba(255, 100, 30, 0.03)');
		ctx.fillStyle = grad;
		ctx.fill();

		// KDE curve line
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(255, 160, 60, 0.8)';
		ctx.lineWidth = 2;
		for (let i = 0; i < xs.length; i++) {
			const sx = toScreenX(xs[i]);
			const sy = toScreenY(Math.min(kdeVals[i], yMax * 0.98), yMax);
			if (i === 0) ctx.moveTo(sx, sy);
			else ctx.lineTo(sx, sy);
		}
		ctx.stroke();
	}

	function drawSamples(ctx: CanvasRenderingContext2D, baseY: number) {
		for (const s of samples) {
			const sx = toScreenX(s);
			if (sx < PAD.left || sx > PAD.left + pw) continue;

			// Tick line
			ctx.strokeStyle = 'rgba(255, 150, 50, 0.4)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(sx, baseY);
			ctx.lineTo(sx, baseY + 7);
			ctx.stroke();

			// Dot
			ctx.fillStyle = '#ff9933';
			ctx.beginPath();
			ctx.arc(sx, baseY + 2, 3, 0, Math.PI * 2);
			ctx.fill();

			// Glow
			ctx.fillStyle = 'rgba(255, 150, 50, 0.2)';
			ctx.beginPath();
			ctx.arc(sx, baseY + 2, 6, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	function drawAxisLabels(ctx: CanvasRenderingContext2D, baseY: number) {
		ctx.fillStyle = 'rgba(255,255,255,0.2)';
		ctx.font = '11px ui-monospace, monospace';
		ctx.textAlign = 'center';

		const xStep = niceStep(viewXMax - viewXMin, 8);
		const xStart = Math.ceil(viewXMin / xStep) * xStep;

		for (let x = xStart; x <= viewXMax; x += xStep) {
			const sx = toScreenX(x);
			const label = Math.abs(x) < 1e-10 ? '0' : x.toFixed(1);
			ctx.fillText(label, sx, baseY + 22);
		}
	}

	function drawCrosshair(ctx: CanvasRenderingContext2D, yMax: number, baseY: number) {
		if (mouseX < PAD.left || mouseX > PAD.left + pw) return;
		if (mouseY < PAD.top - 20 || mouseY > baseY + 30) return;

		const dataX = toDataX(mouseX);
		const pdfY = level.pdf(dataX);
		const curveY = toScreenY(Math.min(pdfY, yMax), yMax);

		// Vertical line
		ctx.strokeStyle = 'rgba(255,255,255,0.06)';
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(mouseX, PAD.top);
		ctx.lineTo(mouseX, baseY);
		ctx.stroke();
		ctx.setLineDash([]);

		// Dot on curve
		ctx.fillStyle = '#00ccff';
		ctx.shadowColor = '#00ccff';
		ctx.shadowBlur = 12;
		ctx.beginPath();
		ctx.arc(mouseX, curveY, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;

		// Click target on axis
		ctx.fillStyle = 'rgba(255,255,255,0.8)';
		ctx.beginPath();
		ctx.arc(mouseX, baseY, 4, 0, Math.PI * 2);
		ctx.fill();

		// Value label
		ctx.fillStyle = 'rgba(255,255,255,0.4)';
		ctx.font = '10px ui-monospace, monospace';
		ctx.textAlign = 'left';
		ctx.fillText(`x=${dataX.toFixed(2)}`, mouseX + 10, curveY - 6);
	}

	function niceStep(range: number, maxTicks: number): number {
		const rough = range / maxTicks;
		const mag = Math.pow(10, Math.floor(Math.log10(rough)));
		const norm = rough / mag;
		if (norm < 1.5) return mag;
		if (norm < 3) return 2 * mag;
		if (norm < 7) return 5 * mag;
		return 10 * mag;
	}

	function handleClick(e: MouseEvent) {
		if (isPanning) return;
		const r = canvas!.getBoundingClientRect();
		const cx = e.clientX - r.left;
		const cy = e.clientY - r.top;
		if (cx < PAD.left || cx > PAD.left + pw) return;
		if (cy < PAD.top - 20 || cy > PAD.top + ph + 20) return;
		onSampleAdd(toDataX(cx));
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const r = canvas!.getBoundingClientRect();
		const mx = toDataX(e.clientX - r.left);
		const f = e.deltaY > 0 ? 1.1 : 0.9;
		const nMin = mx - (mx - viewXMin) * f;
		const nMax = mx + (viewXMax - mx) * f;
		const range = nMax - nMin;
		const minR = 0.5, maxR = (level.xRange[1] - level.xRange[0]) * 3;
		if (range >= minR && range <= maxR) {
			viewXMin = nMin;
			viewXMax = nMax;
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
		const r = canvas!.getBoundingClientRect();
		mouseX = e.clientX - r.left;
		mouseY = e.clientY - r.top;
		if (!isPanning) return;
		const dx = e.clientX - panStartX;
		const shift = -dx * ((panStartViewMax - panStartViewMin) / pw);
		viewXMin = panStartViewMin + shift;
		viewXMax = panStartViewMax + shift;
	}

	function handleMouseLeave() {
		isPanning = false;
		mouseX = -1;
		mouseY = -1;
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
			const midSX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
			const r = canvas!.getBoundingClientRect();
			const midX = toDataX(midSX - r.left);
			const newRange = (panStartViewMax - panStartViewMin) * scale;
			const minR = 0.5, maxR = (level.xRange[1] - level.xRange[0]) * 3;
			if (newRange >= minR && newRange <= maxR) {
				const ratio = (midX - panStartViewMin) / (panStartViewMax - panStartViewMin);
				viewXMin = midX - ratio * newRange;
				viewXMax = midX + (1 - ratio) * newRange;
			}
		}
	}

	function handleTouchEnd(e: TouchEvent) {
		if (e.touches.length < 2) lastPinchDist = 0;
		if (e.changedTouches.length === 1 && e.touches.length === 0 && lastPinchDist === 0) {
			const t = e.changedTouches[0];
			const r = canvas!.getBoundingClientRect();
			const cx = t.clientX - r.left;
			const cy = t.clientY - r.top;
			if (cx >= PAD.left && cx <= PAD.left + pw && cy >= PAD.top - 20 && cy <= PAD.top + ph + 20) {
				onSampleAdd(toDataX(cx));
			}
		}
	}

	export function zoomIn() {
		const mid = (viewXMin + viewXMax) / 2;
		const r = (viewXMax - viewXMin) * 0.8;
		viewXMin = mid - r / 2;
		viewXMax = mid + r / 2;
	}

	export function zoomOut() {
		const mid = (viewXMin + viewXMax) / 2;
		const r = (viewXMax - viewXMin) * 1.25;
		if (r <= (level.xRange[1] - level.xRange[0]) * 3) {
			viewXMin = mid - r / 2;
			viewXMax = mid + r / 2;
		}
	}
</script>

<div bind:this={container} class="h-full w-full">
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {height}px; cursor: none;"
		class="block"
		aria-label="Click to place samples"
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
</div>
