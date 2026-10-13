<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import type { Level } from '$lib/game/levels';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import {
		canvasPoint,
		isPlotTap,
		moveSampleX,
		normalizeShape,
		plotSampleX,
		snapSampleX,
		SAMPLE_DECIMALS,
		type PlotPoint
	} from '$lib/game/plot-interaction';

	interface Props {
		level: Level;
		samples: number[];
		onSampleAdd: (x: number) => void;
		opponentKde?: number[];
		showOpponent?: boolean;
		opponentLabel?: string;
		disabled?: boolean;
	}

	let {
		level,
		samples,
		onSampleAdd,
		opponentKde,
		showOpponent = false,
		opponentLabel = 'Opponent',
		disabled = false
	}: Props = $props();
	const uid = $props.id();
	const PAD = { top: 64, right: 30, bottom: 44, left: 30 };
	const N_POINTS = 250;
	const Y_MAX = 1.13;
	let canvas: HTMLCanvasElement | undefined;
	let width = $state(800);
	let height = $state(500);
	let pointerPoint: PlotPoint | null = $state(null);
	let keyboardActive = $state(false);
	let announcement = $state('');
	let keyboardX = $derived(snapSampleX((level.xRange[0] + level.xRange[1]) / 2, level.xRange));
	const pw = $derived(width - PAD.left - PAD.right);
	const ph = $derived(height - PAD.top - PAD.bottom);
	const xs = $derived(linspace(level.xRange[0], level.xRange[1], N_POINTS));
	const targetPdf = $derived(normalizeShape(xs.map((x) => level.pdf(x))));
	const targetKde = $derived(normalizeShape(computeKDE(samples, xs)));
	const targetOpponent = $derived(showOpponent ? normalizeShape(opponentKde ?? []) : []);
	const previewX = $derived(
		disabled
			? null
			: keyboardActive
				? keyboardX
				: pointerPoint
					? plotSampleX(pointerPoint, { width, height }, level.xRange, PAD)
					: null
	);
	const drawingInputs = $derived({
		level,
		targetPdf,
		targetKde,
		targetOpponent,
		previewX,
		width,
		height,
		reducedMotion: prefersReducedMotion.current
	});

	// Animation buffers are owned by the renderer; they never drive component state.
	let displayKde: number[] = [];
	let displayOpponent: number[] = [];
	let pdfReveal = 0;
	let renderedLevel: Level | undefined;
	let frameHandle = 0;
	let lastFrameTime = 0;
	let pulse: { x: number; startedAt: number } | null = null;
	let gesture: { id: number; start: PlotPoint; cancelled: boolean } | null = null;
	const activePointers = new SvelteSet<number>();
	let colors = {
		axis: 'rgba(255,255,255,0.1)',
		text: 'rgba(255,255,255,0.6)',
		crosshair: 'rgba(255,255,255,0.7)',
		curveFillStart: 'rgba(0,200,255,0.07)',
		curveFillEnd: 'rgba(0,200,255,0)',
		accentCyan: '#00d4ff',
		accentOrange: '#ff9933',
		accentPurple: '#a855f7'
	};

	function refreshColors() {
		const style = getComputedStyle(document.documentElement);
		const value = (name: string) => style.getPropertyValue(name).trim();
		colors = {
			axis: value('--canvas-axis'),
			text: value('--text-secondary'),
			crosshair: value('--canvas-crosshair'),
			curveFillStart: value('--curve-fill-start'),
			curveFillEnd: value('--curve-fill-end'),
			accentCyan: value('--accent-cyan'),
			accentOrange: value('--accent-orange'),
			accentPurple: value('--accent-purple')
		};
		invalidate();
	}

	function attachCanvas(node: HTMLCanvasElement) {
		canvas = node;
		const resize = () => {
			width = node.clientWidth;
			height = node.clientHeight;
			invalidate();
		};
		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(node);
		resize();
		refreshColors();
		const themeObserver = new MutationObserver(refreshColors);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		return () => {
			cancelAnimationFrame(frameHandle);
			frameHandle = 0;
			canvas = undefined;
			resizeObserver.disconnect();
			themeObserver.disconnect();
		};
	}

	function syncDrawing(inputs: typeof drawingInputs) {
		// Keep observer setup attached once, while reactive inputs invalidate the renderer.
		return () => {
			if (inputs.level !== renderedLevel) {
				renderedLevel = inputs.level;
				displayKde = new Array(N_POINTS).fill(0);
				displayOpponent = [];
				pdfReveal = 0;
				pulse = null;
			}
			invalidate();
		};
	}

	function invalidate() {
		if (canvas && !frameHandle) frameHandle = requestAnimationFrame(frame);
	}

	function smoothCurve(display: number[], target: number[], amount: number) {
		let animating = false;
		for (let i = 0; i < target.length; i++) {
			const diff = target[i] - display[i];
			if (Math.abs(diff) > 0.0001 && amount < 1) {
				display[i] += diff * amount;
				animating = true;
			} else display[i] = target[i];
		}
		return animating;
	}

	function frame(now: number) {
		frameHandle = 0;
		if (!canvas || document.hidden) return;
		const elapsed = Math.min(64, Math.max(1, now - lastFrameTime || 16));
		lastFrameTime = now;
		const amount = prefersReducedMotion.current ? 1 : 1 - Math.exp(-elapsed / 95);
		if (displayKde.length !== targetKde.length) displayKde = new Array(targetKde.length).fill(0);
		if (displayOpponent.length !== targetOpponent.length)
			displayOpponent = new Array(targetOpponent.length).fill(0);
		let animating = smoothCurve(displayKde, targetKde, amount);
		animating = smoothCurve(displayOpponent, targetOpponent, amount) || animating;
		if (pdfReveal < 1) {
			pdfReveal += (1 - pdfReveal) * amount;
			if (pdfReveal > 0.999 || prefersReducedMotion.current) pdfReveal = 1;
			else animating = true;
		}
		if (pulse && (prefersReducedMotion.current || now - pulse.startedAt >= 450)) pulse = null;
		draw(now);
		if (animating || pulse) invalidate();
	}

	function toSX(x: number) {
		return PAD.left + ((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0])) * pw;
	}

	function toSY(value: number) {
		return PAD.top + ph - (value / Y_MAX) * ph;
	}

	function traceCurve(ctx: CanvasRenderingContext2D, values: number[]) {
		ctx.beginPath();
		for (let i = 0; i < values.length; i++) {
			const sx = PAD.left + (i / (values.length - 1)) * pw;
			const sy = toSY(values[i]);
			if (i === 0) ctx.moveTo(sx, sy);
			else ctx.lineTo(sx, sy);
		}
	}

	function draw(now: number) {
		if (!canvas || pw <= 0 || ph <= 0) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const pixelWidth = Math.round(width * dpr);
		const pixelHeight = Math.round(height * dpr);
		// Resizing a canvas clears it, so update its backing store only when needed.
		if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
			canvas.width = pixelWidth;
			canvas.height = pixelHeight;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		const baseY = toSY(0);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = colors.axis;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(PAD.left, baseY);
		ctx.lineTo(width - PAD.right, baseY);
		ctx.stroke();

		const revealed = targetPdf.map((value) => value * pdfReveal);
		traceCurve(ctx, revealed);
		ctx.lineTo(width - PAD.right, baseY);
		ctx.lineTo(PAD.left, baseY);
		ctx.closePath();
		const fill = ctx.createLinearGradient(0, PAD.top, 0, baseY);
		fill.addColorStop(0, colors.curveFillStart);
		fill.addColorStop(1, colors.curveFillEnd);
		ctx.fillStyle = fill;
		ctx.fill();

		// Keep the opponent quiet and the target solid beneath your dashed comparison.
		if (displayOpponent.length > 1) {
			traceCurve(ctx, displayOpponent);
			ctx.strokeStyle = colors.accentPurple;
			ctx.lineWidth = 1.8;
			ctx.globalAlpha = 0.75;
			ctx.setLineDash([2, 6]);
			ctx.stroke();
			ctx.globalAlpha = 1;
			ctx.setLineDash([]);
		}
		traceCurve(ctx, revealed);
		ctx.strokeStyle = colors.accentCyan;
		ctx.lineWidth = 3;
		ctx.stroke();
		if (samples.length > 0 || displayKde.some((value) => value > 0.0001)) {
			traceCurve(ctx, displayKde);
			ctx.strokeStyle = colors.accentOrange;
			ctx.lineWidth = 2.5;
			ctx.setLineDash([8, 5]);
			ctx.stroke();
			ctx.setLineDash([]);
		}
		drawSamples(ctx, baseY);
		drawAxisLabels(ctx, baseY);
		if (previewX !== null) drawPreview(ctx, previewX, baseY);
		if (pulse) drawPulse(ctx, pulse.x, (now - pulse.startedAt) / 450, baseY);
	}

	function drawSamples(ctx: CanvasRenderingContext2D, baseY: number) {
		// Stack repeated samples so a cluster stays legible instead of becoming one dot.
		const columns = new SvelteMap<number, number>();
		for (const sample of samples) {
			const sx = toSX(sample);
			if (sx < PAD.left || sx > width - PAD.right) continue;
			const column = Math.round(sx / 7);
			const count = columns.get(column) ?? 0;
			columns.set(column, count + 1);
			const sy = baseY - Math.min(count, 6) * 7;
			ctx.fillStyle = colors.accentOrange;
			ctx.globalAlpha = 0.9;
			ctx.beginPath();
			ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	function drawAxisLabels(ctx: CanvasRenderingContext2D, baseY: number) {
		ctx.fillStyle = colors.text;
		ctx.font = '11px Inter, system-ui, sans-serif';
		ctx.textAlign = 'center';
		const range = level.xRange[1] - level.xRange[0];
		const rough = range / Math.max(3, Math.floor(pw / 80));
		const magnitude = 10 ** Math.floor(Math.log10(rough));
		const normalized = rough / magnitude;
		const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
		const start = Math.ceil(level.xRange[0] / step) * step;
		for (let x = start; x <= level.xRange[1]; x += step)
			ctx.fillText(
				Math.abs(x) < 1e-10 ? '0' : Number(x.toFixed(2)).toString(),
				toSX(x),
				baseY + 22
			);
	}

	function targetHeight(x: number) {
		const index = Math.round(
			((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0])) * (N_POINTS - 1)
		);
		return toSY((targetPdf[index] ?? 0) * pdfReveal);
	}

	function drawPreview(ctx: CanvasRenderingContext2D, x: number, baseY: number) {
		const sx = toSX(x);
		const sy = targetHeight(x);
		ctx.strokeStyle = colors.crosshair;
		ctx.globalAlpha = 0.45;
		ctx.lineWidth = 1;
		ctx.setLineDash([3, 5]);
		ctx.beginPath();
		ctx.moveTo(sx, PAD.top);
		ctx.lineTo(sx, baseY);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		ctx.strokeStyle = colors.accentCyan;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc(sx, sy, 5, 0, Math.PI * 2);
		ctx.stroke();
		ctx.fillStyle = colors.accentOrange;
		ctx.beginPath();
		ctx.arc(sx, baseY, 4.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = colors.text;
		ctx.font = '11px Inter, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(
			`x ${x.toFixed(SAMPLE_DECIMALS)}`,
			Math.max(55, Math.min(width - 55, sx)),
			baseY + 39
		);
	}

	function drawPulse(ctx: CanvasRenderingContext2D, x: number, progress: number, baseY: number) {
		const sx = toSX(x);
		ctx.strokeStyle = colors.accentOrange;
		ctx.lineWidth = 2;
		ctx.globalAlpha = (1 - progress) * 0.65;
		for (const sy of [baseY, targetHeight(x)]) {
			ctx.beginPath();
			ctx.arc(sx, sy, 5 + progress * 20, 0, Math.PI * 2);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function eventPoint(event: MouseEvent | PointerEvent) {
		if (!canvas) return null;
		return canvasPoint(event.clientX, event.clientY, canvas.getBoundingClientRect(), {
			width,
			height
		});
	}

	function addSample(x: number) {
		if (disabled) return;
		const sampleNumber = samples.length + 1;
		keyboardX = x;
		onSampleAdd(x);
		pulse = { x, startedAt: performance.now() };
		announcement = `Sample ${sampleNumber} added at ${x.toFixed(SAMPLE_DECIMALS)}.`;
		invalidate();
	}

	function handleClick(event: MouseEvent) {
		if (disabled) return;
		// Native button activation from keyboards and assistive technology has no coordinates.
		if (event.detail === 0) {
			keyboardActive = true;
			addSample(keyboardX);
			return;
		}
		if (gesture?.cancelled) {
			gesture = null;
			return;
		}
		const point = eventPoint(event);
		const x = point ? plotSampleX(point, { width, height }, level.xRange, PAD) : null;
		gesture = null;
		if (x !== null) addSample(x);
	}

	function handlePointerDown(event: PointerEvent) {
		if (disabled || event.button !== 0) return;
		activePointers.add(event.pointerId);
		if (activePointers.size > 1 || !event.isPrimary) {
			if (gesture) gesture.cancelled = true;
			return;
		}
		gesture = {
			id: event.pointerId,
			start: { x: event.clientX, y: event.clientY },
			cancelled: false
		};
		keyboardActive = false;
		pointerPoint = eventPoint(event);
	}

	function handlePointerMove(event: PointerEvent) {
		if (
			gesture?.id === event.pointerId &&
			!isPlotTap(gesture.start, { x: event.clientX, y: event.clientY })
		)
			gesture.cancelled = true;
		if (!event.isPrimary) return;
		keyboardActive = false;
		pointerPoint = eventPoint(event);
	}

	function handlePointerUp(event: PointerEvent) {
		activePointers.delete(event.pointerId);
		if (
			gesture?.id === event.pointerId &&
			!isPlotTap(gesture.start, { x: event.clientX, y: event.clientY })
		)
			gesture.cancelled = true;
		if (event.pointerType !== 'mouse') pointerPoint = null;
	}

	function handlePointerCancel(event: PointerEvent) {
		activePointers.delete(event.pointerId);
		if (gesture) gesture.cancelled = true;
		pointerPoint = null;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
		const next = moveSampleX(keyboardX, event.key, level.xRange, event.shiftKey);
		if (next !== null) {
			event.preventDefault();
			keyboardActive = true;
			keyboardX = next;
			announcement = `Sample position ${next.toFixed(SAMPLE_DECIMALS)}. Press Enter to add.`;
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (!event.repeat) {
				keyboardActive = true;
				addSample(keyboardX);
			}
		}
	}
</script>

<svelte:window
	onresize={invalidate}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
/>
<svelte:document onvisibilitychange={invalidate} />

<div class="plot-shell">
	<button
		type="button"
		class="plot-input"
		data-game-chart
		{disabled}
		aria-label="Add a sample to match the target curve"
		aria-describedby="{uid}-instructions"
		onclick={handleClick}
		onkeydown={handleKeydown}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerleave={() => {
			pointerPoint = null;
		}}
		onfocus={(event) => {
			keyboardActive = event.currentTarget.matches(':focus-visible');
		}}
		onblur={() => {
			keyboardActive = false;
		}}
	>
		<canvas {@attach attachCanvas} {@attach syncDrawing(drawingInputs)} aria-hidden="true"></canvas>
		<span class="plot-header" aria-hidden="true">
			<span class="plot-legend">
				<span class="legend-item"><span class="legend-line target"></span>Target</span>
				<span class="legend-item"><span class="legend-line yours"></span>Your shape</span>
				{#if showOpponent}<span class="legend-item" title={opponentLabel}
						><span class="legend-line opponent"></span><span class="opponent-name"
							>{opponentLabel}</span
						></span
					>{/if}
			</span>
			<span class="plot-hint"
				>{#if disabled}Round complete{:else if keyboardActive}← → to move. Enter to add.{:else}Click
					anywhere. Left/right sets the sample.{/if}</span
			>
		</span>
	</button>
	<p id="{uid}-instructions" class="sr-only">
		The solid blue curve is your target. The dashed orange curve is your shape. Click or tap
		anywhere on the chart to place a sample at that horizontal position. Use arrow keys to choose a
		position, Shift to move faster, Home or End for the edges, and Enter or Space to add a sample.
	</p>
	<p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
</div>

<style>
	.plot-shell {
		position: relative;
		width: 100%;
		height: 100%;
	}
	.plot-input {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: transparent;
		cursor: crosshair;
		text-align: left;
		touch-action: manipulation;
	}
	.plot-input:focus-visible {
		outline: 2px solid var(--accent-cyan);
		outline-offset: -3px;
	}
	.plot-input:disabled {
		cursor: default;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.plot-header {
		position: absolute;
		top: 16px;
		right: 30px;
		left: 30px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 24px;
		pointer-events: none;
	}
	.plot-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
	}
	.legend-line {
		width: 23px;
		border-top: 3px solid var(--accent-cyan);
	}
	.legend-line.yours {
		border-color: var(--accent-orange);
		border-top-style: dashed;
	}
	.legend-line.opponent {
		border-color: var(--accent-purple);
		border-top-style: dotted;
	}
	.opponent-name {
		overflow: hidden;
		max-width: 110px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.plot-hint {
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.5;
	}
	@media (max-width: 640px) {
		.plot-header {
			gap: 6px;
		}
		.plot-legend {
			gap: 12px;
		}
		.plot-hint {
			flex-basis: 100%;
			font-size: 10px;
		}
		.legend-item {
			font-size: 11px;
		}
		.opponent-name {
			max-width: 80px;
		}
	}
</style>
