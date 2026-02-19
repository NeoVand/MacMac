<script lang="ts">
	import { onMount } from 'svelte';
	import { levels } from '$lib/game/levels';
	import { getDifficultyColor } from '$lib/game/scoring';
	import { gaussian, linspace } from '$lib/game/math';

	let heroCanvas: HTMLCanvasElement | undefined = $state();
	let animFrame = 0;

	onMount(() => {
		if (!heroCanvas) return;
		let running = true;
		let t = 0;
		function animate() {
			if (!running || !heroCanvas) return;
			t += 0.012;
			drawHero(t);
			animFrame = requestAnimationFrame(animate);
		}
		animate();
		return () => { running = false; cancelAnimationFrame(animFrame); };
	});

	function drawHero(t: number) {
		if (!heroCanvas) return;
		const ctx = heroCanvas.getContext('2d');
		if (!ctx) return;

		const w = heroCanvas.clientWidth;
		const h = heroCanvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		heroCanvas.width = w * dpr;
		heroCanvas.height = h * dpr;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);

		const padX = 30, padTop = 20, padBot = 10;
		const pw = w - padX * 2;
		const ph = h - padTop - padBot;

		// 3 asymmetric moving modes
		const m1 = -2.2 + Math.sin(t * 0.4) * 0.6;
		const m2 = 0.3 + Math.sin(t * 0.7 + 1.5) * 0.4;
		const m3 = 2.5 + Math.cos(t * 0.3 + 3) * 0.5;

		const s1 = 0.55 + Math.sin(t * 0.5) * 0.1;
		const s2 = 0.8 + Math.cos(t * 0.6) * 0.15;
		const s3 = 0.45 + Math.sin(t * 0.8 + 2) * 0.08;

		const pdf = (x: number) =>
			0.3 * gaussian(x, m1, s1) + 0.4 * gaussian(x, m2, s2) + 0.3 * gaussian(x, m3, s3);

		const xMin = -5, xMax = 5;
		const pts = linspace(xMin, xMax, 300);
		const vals = pts.map(pdf);
		const yMax = Math.max(...vals) * 1.1;

		const toX = (x: number) => padX + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => padTop + ph - (y / yMax) * ph;

		// Build path
		const pathPts: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i])]);

		// Gradient fill under curve
		ctx.beginPath();
		ctx.moveTo(pathPts[0][0], pathPts[0][1]);
		for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
		ctx.lineTo(toX(xMax), toY(0));
		ctx.lineTo(toX(xMin), toY(0));
		ctx.closePath();

		const fillGrad = ctx.createLinearGradient(0, padTop, 0, padTop + ph);
		fillGrad.addColorStop(0, 'rgba(0, 200, 255, 0.15)');
		fillGrad.addColorStop(0.5, 'rgba(120, 60, 230, 0.08)');
		fillGrad.addColorStop(1, 'rgba(0, 200, 255, 0.0)');
		ctx.fillStyle = fillGrad;
		ctx.fill();

		// Glow
		ctx.beginPath();
		ctx.moveTo(pathPts[0][0], pathPts[0][1]);
		for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
		ctx.strokeStyle = 'rgba(0, 200, 255, 0.1)';
		ctx.lineWidth = 12;
		ctx.stroke();

		// Gradient stroke using two overlapping strokes
		ctx.beginPath();
		ctx.moveTo(pathPts[0][0], pathPts[0][1]);
		for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
		const strokeGrad = ctx.createLinearGradient(toX(xMin), 0, toX(xMax), 0);
		strokeGrad.addColorStop(0, '#00ccff');
		strokeGrad.addColorStop(0.5, '#a855f7');
		strokeGrad.addColorStop(1, '#00ccff');
		ctx.strokeStyle = strokeGrad;
		ctx.lineWidth = 2.5;
		ctx.stroke();
	}

	// Pre-compute mini SVG paths for each level
	function levelSvgPath(level: typeof levels[0], w: number, h: number): string {
		const pad = 4;
		const xs = linspace(level.xRange[0], level.xRange[1], 60);
		const vals = xs.map((x) => level.pdf(x));
		const yMax = Math.max(...vals) * 1.1 || 1;
		const pts = xs.map((x, i) => {
			const sx = pad + ((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0])) * (w - pad * 2);
			const sy = pad + (h - pad * 2) - (vals[i] / yMax) * (h - pad * 2);
			return `${sx.toFixed(1)},${sy.toFixed(1)}`;
		});
		return `M${pts.join('L')}`;
	}
</script>

<svelte:head>
	<title>MacMac — The Sampling Game</title>
	<meta name="description" content="Match probability distributions with the fewest clicks. A game about sampling, intuition, and efficiency." />
</svelte:head>

<div class="flex min-h-dvh flex-col items-center">
	<!-- Hero -->
	<div class="relative flex w-full max-w-2xl flex-col items-center px-4 pt-16 sm:pt-24">
		<canvas
			bind:this={heroCanvas}
			class="absolute inset-0 h-full w-full opacity-50"
			style="pointer-events: none;"
		></canvas>

		<h1 class="relative z-10 mb-3 text-center text-6xl font-extrabold tracking-tighter text-white sm:text-8xl">
			Mac<span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-transparent">Mac</span>
		</h1>
		<p class="relative z-10 mb-8 max-w-xs text-center text-sm leading-relaxed text-white/35 sm:text-base">
			See a curve. Click to sample. Match the shape with the fewest clicks.
		</p>

		<div class="relative z-10 flex gap-3">
			<a
				href="/play/1"
				class="flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-game-cyan to-cyan-400 px-7 text-sm font-bold text-game-bg shadow-lg shadow-game-cyan/20 transition hover:scale-105 hover:shadow-game-cyan/30 active:scale-95"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
				Play
			</a>
			<a
				href="/leaderboard"
				class="flex h-12 items-center gap-2 rounded-xl bg-white/[0.06] px-6 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 1a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 1zM5.05 3.05a.75.75 0 011.06 0l1.062 1.06A.75.75 0 116.11 5.173L5.05 4.11a.75.75 0 010-1.06zm9.9 0a.75.75 0 010 1.06l-1.06 1.062a.75.75 0 01-1.062-1.061l1.061-1.06a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6zm-6.25 3a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H3a.75.75 0 01.75.75zm14 0a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5H17a.75.75 0 01.75.75zm-11.89 5.828a.75.75 0 011.06-1.06l1.061 1.06a.75.75 0 01-1.06 1.061l-1.06-1.06zm8.768-1.06a.75.75 0 011.06 0l1.061 1.06a.75.75 0 11-1.06 1.061l-1.06-1.06a.75.75 0 010-1.06zM10 16a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 16z" clip-rule="evenodd" /></svg>
				Leaderboard
			</a>
		</div>
	</div>

	<!-- Levels with mini curve previews -->
	<div class="mt-20 w-full max-w-3xl px-4 sm:mt-28">
		<h2 class="mb-5 text-xs font-medium tracking-[0.2em] text-white/20 uppercase">Levels</h2>
		<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
			{#each levels as level}
				{@const path = levelSvgPath(level, 160, 48)}
				<a
					href="/play/{level.id}"
					class="group relative overflow-hidden rounded-xl bg-white/[0.025] p-3 transition hover:bg-white/[0.055]"
				>
					<!-- Mini curve SVG -->
					<svg viewBox="0 0 160 48" class="mb-2 w-full opacity-40 transition group-hover:opacity-70">
						<defs>
							<linearGradient id="lc{level.id}" x1="0" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
								<stop offset="0%" stop-color="#00ccff" />
								<stop offset="100%" stop-color="#a855f7" />
							</linearGradient>
						</defs>
						<path d="{path}L160,48L0,48Z" fill="url(#lc{level.id})" opacity="0.1" />
						<path d={path} fill="none" stroke="url(#lc{level.id})" stroke-width="1.5" />
					</svg>

					<div class="flex items-center gap-1.5">
						<span
							class="inline-block h-1.5 w-1.5 rounded-full"
							style="background-color: {getDifficultyColor(level.difficulty)}"
						></span>
						<span class="text-sm font-semibold text-white/60 group-hover:text-white/90">
							{level.name}
						</span>
					</div>
				</a>
			{/each}
		</div>
	</div>

	<!-- How to play -->
	<div class="mt-16 mb-20 w-full max-w-lg px-4">
		<div class="grid grid-cols-3 gap-6 text-center">
			<div>
				<div class="mb-1 text-2xl font-bold text-white/10">1</div>
				<div class="text-xs font-medium text-white/45">See the curve</div>
			</div>
			<div>
				<div class="mb-1 text-2xl font-bold text-white/10">2</div>
				<div class="text-xs font-medium text-white/45">Click to sample</div>
			</div>
			<div>
				<div class="mb-1 text-2xl font-bold text-white/10">3</div>
				<div class="text-xs font-medium text-white/45">Beat the board</div>
			</div>
		</div>
	</div>
</div>
