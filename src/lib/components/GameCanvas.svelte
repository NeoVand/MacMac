<script lang="ts">
	import { onMount } from 'svelte';
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

	let mouseX = $state(-1);
	let mouseY = $state(-1);
	let lastTouchTime = 0;

	let displayKde: number[] = [];
	let targetKde: number[] = [];
	let animHandle = 0;
	let themeVersion = $state(0);
	let pdfReveal = 0;
	let displayYMax = 1;

	const LERP_SPEED = 0.12;
	const PAD = { top: 30, right: 30, bottom: 44, left: 30 };
	const SAMPLE_DECIMALS = 2;
	const SAMPLE_SCALE = 10 ** SAMPLE_DECIMALS;

	const pw = $derived(width - PAD.left - PAD.right);
	const ph = $derived(height - PAD.top - PAD.bottom);

	// Cached color palette — refreshed on theme change, not per frame
	let colors = {
		canvasBg: '#0a0a1a', axis: 'rgba(255,255,255,0.07)', text: 'rgba(255,255,255,0.22)',
		hint: 'rgba(255,255,255,0.25)', crosshair: 'rgba(255,255,255,0.7)',
		crosshairRing: 'rgba(255,255,255,0.15)', curveGlow: 'rgba(0,200,255,0.12)',
		curveFillStart: 'rgba(0,200,255,0.07)', curveFillEnd: 'rgba(0,200,255,0.0)',
		accentCyan: '#00d4ff', kdeFillStart: 'rgba(255,130,40,0.22)',
		kdeFillEnd: 'rgba(255,100,30,0.02)', kdeStroke: 'rgba(255,150,50,0.75)',
		sampleGlow: 'rgba(255,150,50,0.1)', sampleDot: 'rgba(255,153,51,0.65)',
	};

	function refreshColors() {
		const s = getComputedStyle(document.documentElement);
		const v = (name: string) => s.getPropertyValue(name).trim();
		colors = {
			canvasBg: v('--canvas-bg'), axis: v('--canvas-axis'), text: v('--canvas-text'),
			hint: v('--canvas-hint'), crosshair: v('--canvas-crosshair'),
			crosshairRing: v('--canvas-crosshair-ring'), curveGlow: v('--curve-glow'),
			curveFillStart: v('--curve-fill-start'), curveFillEnd: v('--curve-fill-end'),
			accentCyan: v('--accent-cyan'), kdeFillStart: v('--kde-fill-start'),
			kdeFillEnd: v('--kde-fill-end'), kdeStroke: v('--kde-stroke'),
			sampleGlow: v('--sample-glow'), sampleDot: v('--sample-dot'),
		};
		themeVersion++;
	}

	function toSX(x: number) { return PAD.left + ((x - viewXMin) / (viewXMax - viewXMin)) * pw; }
	function toDX(sx: number) { return viewXMin + ((sx - PAD.left) / pw) * (viewXMax - viewXMin); }
	function toSY(y: number, yMax: number) { return PAD.top + ph - (y / yMax) * ph; }
	function snapSampleX(x: number) {
		const clamped = Math.max(level.xRange[0], Math.min(level.xRange[1], x));
		return Math.round((clamped + Number.EPSILON) * SAMPLE_SCALE) / SAMPLE_SCALE;
	}

	$effect(() => {
		level;
		viewXMin = level.xRange[0];
		viewXMax = level.xRange[1];
		const nPts = 400;
		displayKde = new Array(nPts).fill(0);
		targetKde = new Array(nPts).fill(0);
		pdfReveal = 0;
		// Initialize yMax from the PDF so it's ready before animation starts
		const xs = linspace(level.xRange[0], level.xRange[1], 100);
		displayYMax = Math.max(...xs.map((x) => level.pdf(x))) * 1.15 || 1;
	});

	$effect(() => {
		void samples; void viewXMin; void viewXMax;
		if (pw <= 0) return;
		const nPts = 400;
		const xs = linspace(viewXMin, viewXMax, nPts);
		if (samples.length === 0) {
			targetKde = new Array(nPts).fill(0);
		} else {
			targetKde = computeKDE(samples, xs);
		}
		if (displayKde.length !== targetKde.length) {
			displayKde = new Array(targetKde.length).fill(0);
		}
	});

	onMount(() => {
		refreshColors();
		const resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (entry) {
				width = entry.contentRect.width;
				height = entry.contentRect.height;
			}
		});
		if (container) {
			width = container.clientWidth;
			height = container.clientHeight;
			resizeObserver.observe(container);
		}

		// Watch for theme class changes on <html>
		const themeObserver = new MutationObserver(() => {
			refreshColors();
		});
		themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		let running = true;
		function frame() {
			if (!running) return;
			let needsUpdate = false;

			// Animate PDF reveal
			if (pdfReveal < 0.999) {
				pdfReveal += (1 - pdfReveal) * 0.06;
				if (pdfReveal > 0.999) pdfReveal = 1;
				needsUpdate = true;
			}

			for (let i = 0; i < displayKde.length; i++) {
				const diff = targetKde[i] - displayKde[i];
				if (Math.abs(diff) > 0.0001) {
					displayKde[i] += diff * LERP_SPEED;
					needsUpdate = true;
				} else {
					displayKde[i] = targetKde[i];
				}
			}

			// Smooth yMax transitions
			const kdeMax = displayKde.length > 0 ? Math.max(...displayKde) : 0;
			const rawPdfMax = pw > 0 ? Math.max(...linspace(viewXMin, viewXMax, 100).map((x) => level.pdf(x))) : 1;
			const targetYMax = Math.max(rawPdfMax, kdeMax) * 1.15 || 1;
			const yDiff = targetYMax - displayYMax;
			if (Math.abs(yDiff) > 0.001) {
				displayYMax += yDiff * 0.08;
				needsUpdate = true;
			} else {
				displayYMax = targetYMax;
			}

			draw(needsUpdate);
			animHandle = requestAnimationFrame(frame);
		}
		frame();
		return () => {
			running = false;
			cancelAnimationFrame(animHandle);
			themeObserver.disconnect();
			resizeObserver.disconnect();
		};
	});

	let lastDrawnWidth = 0;
	let lastDrawnHeight = 0;
	let lastDrawnMouseX = -1;
	let lastDrawnViewMin = 0;
	let lastDrawnViewMax = 0;
	let lastDrawnSamplesLen = 0;
	let lastDrawnTheme = 0;

	function draw(kdeAnimating: boolean) {
		if (!canvas || pw <= 0 || ph <= 0) return;
		const stateChanged =
			width !== lastDrawnWidth || height !== lastDrawnHeight ||
			mouseX !== lastDrawnMouseX || viewXMin !== lastDrawnViewMin ||
			viewXMax !== lastDrawnViewMax || samples.length !== lastDrawnSamplesLen ||
			themeVersion !== lastDrawnTheme;
		if (!kdeAnimating && !stateChanged) return;
		lastDrawnWidth = width; lastDrawnHeight = height; lastDrawnMouseX = mouseX;
		lastDrawnViewMin = viewXMin; lastDrawnViewMax = viewXMax;
		lastDrawnSamplesLen = samples.length; lastDrawnTheme = themeVersion;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		canvas.width = width * dpr;
		canvas.height = height * dpr;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, height);

		ctx.fillStyle = colors.canvasBg;
		ctx.fillRect(0, 0, width, height);

		const nPts = 400;
		const xs = linspace(viewXMin, viewXMax, nPts);
		const rawPdf = xs.map((x) => level.pdf(x));
		const yMax = displayYMax > 0 ? displayYMax : 1;
		const pdfVals = rawPdf.map((v) => v * pdfReveal);
		const baseY = toSY(0, yMax);

		// Axis
		ctx.strokeStyle = colors.axis;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(PAD.left, baseY);
		ctx.lineTo(PAD.left + pw, baseY);
		ctx.stroke();

		if (displayKde.length === nPts) drawKDE(ctx, xs, yMax, baseY);
		drawPDF(ctx, xs, pdfVals, yMax, baseY);
		drawSamples(ctx, baseY);
		drawAxisLabels(ctx, baseY);
		if (samples.length === 0) drawOnboardingHint(ctx, baseY);

		const axisZoneTop = baseY - ph * 0.4;
		if (mouseX >= PAD.left && mouseX <= PAD.left + pw && mouseY >= axisZoneTop && mouseY <= height) {
			drawCrosshair(ctx, yMax, baseY);
		}
	}

	function drawPDF(ctx: CanvasRenderingContext2D, xs: number[], vals: number[], yMax: number, baseY: number) {
		const accentCyan = colors.accentCyan;

		// Glow
		ctx.beginPath();
		ctx.strokeStyle = colors.curveGlow;
		ctx.lineWidth = 10;
		for (let i = 0; i < xs.length; i++) {
			const sx = toSX(xs[i]); const sy = toSY(vals[i], yMax);
			i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
		}
		ctx.stroke();

		// Main curve
		ctx.beginPath();
		ctx.strokeStyle = accentCyan;
		ctx.lineWidth = 2.5;
		for (let i = 0; i < xs.length; i++) {
			const sx = toSX(xs[i]); const sy = toSY(vals[i], yMax);
			i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
		}
		ctx.stroke();

		// Fill under
		ctx.lineTo(toSX(xs[xs.length - 1]), baseY);
		ctx.lineTo(toSX(xs[0]), baseY);
		ctx.closePath();
		const g = ctx.createLinearGradient(0, PAD.top, 0, baseY);
		g.addColorStop(0, colors.curveFillStart);
		g.addColorStop(1, colors.curveFillEnd);
		ctx.fillStyle = g;
		ctx.fill();
	}

	function drawKDE(ctx: CanvasRenderingContext2D, xs: number[], yMax: number, baseY: number) {
		const clamped = displayKde.map((v) => Math.min(v, yMax * 0.99));

		ctx.beginPath();
		for (let i = 0; i < xs.length; i++) {
			const sx = toSX(xs[i]); const sy = toSY(clamped[i], yMax);
			i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
		}
		ctx.lineTo(toSX(xs[xs.length - 1]), baseY);
		ctx.lineTo(toSX(xs[0]), baseY);
		ctx.closePath();
		const g = ctx.createLinearGradient(0, PAD.top, 0, baseY);
		g.addColorStop(0, colors.kdeFillStart);
		g.addColorStop(1, colors.kdeFillEnd);
		ctx.fillStyle = g;
		ctx.fill();

		ctx.beginPath();
		ctx.strokeStyle = colors.kdeStroke;
		ctx.lineWidth = 2;
		for (let i = 0; i < xs.length; i++) {
			const sx = toSX(xs[i]); const sy = toSY(clamped[i], yMax);
			i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
		}
		ctx.stroke();
	}

	function drawSamples(ctx: CanvasRenderingContext2D, baseY: number) {
		const glow = colors.sampleGlow;
		const dot = colors.sampleDot;
		for (const s of samples) {
			const sx = toSX(s);
			if (sx < PAD.left || sx > PAD.left + pw) continue;
			ctx.fillStyle = glow;
			ctx.beginPath(); ctx.arc(sx, baseY, 10, 0, Math.PI * 2); ctx.fill();
			ctx.fillStyle = dot;
			ctx.beginPath(); ctx.arc(sx, baseY, 5, 0, Math.PI * 2); ctx.fill();
		}
	}

	function drawOnboardingHint(ctx: CanvasRenderingContext2D, baseY: number) {
		const cx = PAD.left + pw * 0.5;
		const textY = baseY - 55;
		const arrowStartY = textY + 8;
		const arrowTipY = baseY - 10;
		const hintColor = colors.hint;

		ctx.fillStyle = hintColor;
		ctx.font = "italic 14px 'Inter', sans-serif";
		ctx.textAlign = 'center';
		ctx.fillText('Click here to add samples', cx, textY);

		ctx.strokeStyle = hintColor;
		ctx.lineWidth = 1.5;
		ctx.beginPath(); ctx.moveTo(cx, arrowStartY); ctx.lineTo(cx, arrowTipY - 5); ctx.stroke();

		ctx.fillStyle = hintColor;
		ctx.beginPath();
		ctx.moveTo(cx, arrowTipY); ctx.lineTo(cx - 5, arrowTipY - 8); ctx.lineTo(cx + 5, arrowTipY - 8);
		ctx.closePath(); ctx.fill();
	}

	function drawAxisLabels(ctx: CanvasRenderingContext2D, baseY: number) {
		ctx.fillStyle = colors.text;
		ctx.font = '11px ui-monospace, monospace';
		ctx.textAlign = 'center';
		const xStep = niceStep(viewXMax - viewXMin, 8);
		const xStart = Math.ceil(viewXMin / xStep) * xStep;
		for (let x = xStart; x <= viewXMax; x += xStep) {
			ctx.fillText(Math.abs(x) < 1e-10 ? '0' : x.toFixed(1), toSX(x), baseY + 24);
		}
	}

	function drawCrosshair(ctx: CanvasRenderingContext2D, yMax: number, baseY: number) {
		const dataX = snapSampleX(toDX(mouseX));
		const snappedX = toSX(dataX);
		ctx.strokeStyle = colors.axis;
		ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
		ctx.beginPath(); ctx.moveTo(snappedX, baseY - 20); ctx.lineTo(snappedX, baseY); ctx.stroke();
		ctx.setLineDash([]);

		ctx.fillStyle = colors.crosshair;
		ctx.beginPath(); ctx.arc(snappedX, baseY, 5, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = colors.crosshairRing;
		ctx.beginPath(); ctx.arc(snappedX, baseY, 10, 0, Math.PI * 2); ctx.fill();

		ctx.fillStyle = colors.text;
		ctx.font = '9px ui-monospace, monospace';
		ctx.textAlign = 'center';
		ctx.fillText(dataX.toFixed(SAMPLE_DECIMALS), snappedX, baseY + 36);
	}

	function niceStep(range: number, maxTicks: number) {
		const rough = range / maxTicks;
		const mag = Math.pow(10, Math.floor(Math.log10(rough)));
		const norm = rough / mag;
		if (norm < 1.5) return mag; if (norm < 3) return 2 * mag; if (norm < 7) return 5 * mag;
		return 10 * mag;
	}

	function handleClick(e: MouseEvent) {
		// Ignore synthetic click from touch (touchend already handled it)
		if (Date.now() - lastTouchTime < 500) return;
		const r = canvas!.getBoundingClientRect();
		const cx = e.clientX - r.left; const cy = e.clientY - r.top;
		if (cx < PAD.left || cx > PAD.left + pw || cy < 0 || cy > height) return;
		onSampleAdd(snapSampleX(toDX(cx)));
	}

	function handleMouseMove(e: MouseEvent) {
		const r = canvas!.getBoundingClientRect();
		mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
	}

	function handleMouseLeave() { mouseX = -1; mouseY = -1; }

	function handleTouchEnd(e: TouchEvent) {
		if (e.changedTouches.length === 1 && e.touches.length === 0) {
			e.preventDefault();
			const t = e.changedTouches[0]; const r = canvas!.getBoundingClientRect();
			const cx = t.clientX - r.left;
			if (cx >= PAD.left && cx <= PAD.left + pw) {
				lastTouchTime = Date.now();
				onSampleAdd(snapSampleX(toDX(cx)));
			}
		}
	}
</script>

<div bind:this={container} class="h-full w-full">
	<canvas
		bind:this={canvas}
		style="width: {width}px; height: {height}px; cursor: crosshair;"
		class="block"
		aria-label="Click to place samples"
		onclick={handleClick}
		onmousemove={handleMouseMove}
		onmouseleave={handleMouseLeave}
		ontouchend={handleTouchEnd}
	></canvas>
</div>
