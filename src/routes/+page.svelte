<script lang="ts">
	import { onMount } from 'svelte';
	import { levels } from '$lib/game/levels';
	import { getDifficultyColor } from '$lib/game/scoring';
	import { gaussian, linspace } from '$lib/game/math';
	import AppHeader from '$lib/components/AppHeader.svelte';

	let heroCanvas: HTMLCanvasElement | undefined = $state();
	let animFrame = 0;

	let heroColors = { accentCyan: '#00d4ff', accentPurple: '#a855f7', curveGlow: 'rgba(0,200,255,0.12)', curveFillStart: 'rgba(0,200,255,0.07)', curveFillEnd: 'rgba(0,200,255,0.0)' };

	function refreshHeroColors() {
		const s = getComputedStyle(document.documentElement);
		const v = (n: string) => s.getPropertyValue(n).trim();
		heroColors = {
			accentCyan: v('--accent-cyan'), accentPurple: v('--accent-purple'),
			curveGlow: v('--curve-glow'), curveFillStart: v('--curve-fill-start'),
			curveFillEnd: v('--curve-fill-end')
		};
	}

	onMount(() => {
		if (!heroCanvas) return;
		refreshHeroColors();

		const observer = new MutationObserver(() => refreshHeroColors());
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

		let running = true;
		let t = 0;
		function animate() {
			if (!running || !heroCanvas) return;
			t += 0.012;
			drawHero(t);
			animFrame = requestAnimationFrame(animate);
		}
		animate();
		return () => { running = false; cancelAnimationFrame(animFrame); observer.disconnect(); };
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

		const padX = 48, padTop = 10, padBot = 6;
		const pw = w - padX * 2;
		const ph = h - padTop - padBot;

		const m1 = -2.2 + Math.sin(t * 0.4) * 0.6;
		const m2 = 0.3 + Math.sin(t * 0.7 + 1.5) * 0.4;
		const m3 = 2.5 + Math.cos(t * 0.3 + 3) * 0.5;
		const s1 = 0.55 + Math.sin(t * 0.5) * 0.1;
		const s2 = 0.8 + Math.cos(t * 0.6) * 0.15;
		const s3 = 0.45 + Math.sin(t * 0.8 + 2) * 0.08;

		// Amplitude oscillates so peaks sometimes get much smaller (0.25 to 1)
		const amplitude = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.18));
		const pdf = (x: number) =>
			amplitude * (0.3 * gaussian(x, m1, s1) + 0.4 * gaussian(x, m2, s2) + 0.3 * gaussian(x, m3, s3));

		const xMin = -5, xMax = 5;
		const pts = linspace(xMin, xMax, 300);
		const vals = pts.map(pdf);
		const yMax = Math.max(...vals) * 1.0;

		const toX = (x: number) => padX + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => padTop + ph - (y / yMax) * ph;

		const accentCyan = heroColors.accentCyan;
		const accentPurple = heroColors.accentPurple;

		const scales = linspace(0.15, 1, 24);
		const strokeGrad = ctx.createLinearGradient(toX(xMin), 0, toX(xMax), 0);
		strokeGrad.addColorStop(0, accentCyan);
		strokeGrad.addColorStop(0.5, accentPurple);
		strokeGrad.addColorStop(1, accentCyan);

		for (let si = 0; si < scales.length; si++) {
			const s = scales[si];
			const alpha = si === scales.length - 1 ? 1.0 : 0.12 + (si / (scales.length - 1)) * 0.5;
			const lineW = si === scales.length - 1 ? 2.5 : 0.8 + (si / (scales.length - 1)) * 0.6;
			const scaledPts: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i] * s)]);

			if (si === scales.length - 1) {
				ctx.beginPath();
				scaledPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(toX(xMax), toY(0));
				ctx.lineTo(toX(xMin), toY(0));
				ctx.closePath();
				const fillGrad = ctx.createLinearGradient(0, padTop, 0, padTop + ph);
				fillGrad.addColorStop(0, heroColors.curveFillStart);
				fillGrad.addColorStop(1, heroColors.curveFillEnd);
				ctx.fillStyle = fillGrad;
				ctx.fill();

				ctx.beginPath();
				scaledPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.strokeStyle = heroColors.curveGlow;
				ctx.lineWidth = 12;
				ctx.stroke();
			}

			ctx.beginPath();
			scaledPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = strokeGrad;
			ctx.lineWidth = lineW;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	const FAMILY_SCALES = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0];

	function levelSvgPaths(level: typeof levels[0], w: number, h: number): { path: string; scale: number }[] {
		const pad = 4;
		const xs = linspace(level.xRange[0], level.xRange[1], 60);
		const vals = xs.map((x) => level.pdf(x));
		const yMax = Math.max(...vals) * 1.1 || 1;

		return FAMILY_SCALES.map((s) => {
			const pts = xs.map((x, i) => {
				const sx = pad + ((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0])) * (w - pad * 2);
				const sy = pad + (h - pad * 2) - ((vals[i] * s) / yMax) * (h - pad * 2);
				return `${sx.toFixed(1)},${sy.toFixed(1)}`;
			});
			return { path: `M${pts.join('L')}`, scale: s };
		});
	}
</script>

<svelte:head>
	<title>macmac — The Sampling Game</title>
	<meta name="description" content="Match probability distributions with the fewest clicks. A game about sampling, intuition, and efficiency." />
	<meta property="og:title" content="macmac — The Sampling Game" />
	<meta property="og:description" content="Match probability distributions with the fewest clicks. A game about MCMC intuition." />
	<meta property="og:url" content="https://macmac-gilt.vercel.app" />
</svelte:head>

<div class="relative flex min-h-dvh flex-col items-center">
	<div class="relative z-20 w-full">
		<AppHeader />
	</div>

	<!-- Hero + Steps -->
	<div class="relative flex min-h-[240px] w-full flex-col sm:min-h-[280px]">
		<canvas
			bind:this={heroCanvas}
			class="absolute inset-0 h-full w-full opacity-50"
			style="pointer-events: none;"
		></canvas>

		<div class="relative z-10 flex min-h-[240px] flex-1 flex-col items-center px-4 pt-2 sm:min-h-[280px] sm:pt-12">
			<h1 class="mb-1 text-center sm:mb-2" style="font-family: 'Space Grotesk', sans-serif;">
				<span class="text-5xl tracking-tight sm:text-8xl" style="color: var(--text-primary); opacity: 0.85;">mac</span><span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-5xl tracking-tight text-transparent sm:text-8xl">mac</span>
			</h1>
			<p class="mb-0 text-center text-sm font-medium tracking-[0.2em] uppercase sm:text-base" style="color: var(--text-secondary);">
				the sampling game
			</p>

			<!-- Action buttons -->
			<div class="mx-auto mt-6 flex w-full max-w-sm flex-wrap justify-center gap-2 px-2 sm:mt-10 sm:max-w-none sm:gap-2.5 sm:px-0">
				<a href="/play/1" class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-semibold backdrop-blur-sm transition hover:brightness-110 sm:h-11 sm:flex-initial sm:gap-2 sm:rounded-2xl sm:px-6 sm:text-[13px]" style="background: color-mix(in srgb, var(--accent-cyan) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
					<span class="truncate">Play</span>
				</a>
				<a href="/leaderboard" class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium backdrop-blur-sm transition hover:brightness-110 sm:h-11 sm:flex-initial sm:gap-2 sm:rounded-2xl sm:px-6 sm:text-[13px]" style="background: color-mix(in srgb, #eab308 7%, transparent); border: 1px solid color-mix(in srgb, #eab308 20%, transparent); color: color-mix(in srgb, #eab308 70%, var(--text-primary));">
					<svg viewBox="0 0 24 24" fill="#eab308" class="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
					<span class="truncate">Leaderboard</span>
				</a>
				<a href="/about" class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-medium backdrop-blur-sm transition hover:brightness-110 sm:h-11 sm:flex-initial sm:gap-2 sm:rounded-2xl sm:px-6 sm:text-[13px]" style="background: color-mix(in srgb, var(--text-primary) 4%, transparent); border: 1px solid var(--border); color: var(--text-secondary);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>
					<span class="truncate">About</span>
				</a>
			</div>
		</div>
	</div>

	<!-- Levels -->
	<div class="mx-auto mt-4 w-full max-w-3xl px-4 pb-12 sm:mt-8 sm:px-4 sm:pb-16">
		<h2 class="mb-3 text-[10px] font-medium tracking-[0.2em] uppercase" style="color: var(--text-tertiary);">Levels</h2>
		<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
			{#each levels as level}
				{@const family = levelSvgPaths(level, 160, 48)}
				<a
					href="/play/{level.id}"
					class="group overflow-hidden rounded-2xl p-2.5 transition hover:opacity-80"
					style="background: var(--surface);"
				>
					<svg viewBox="0 0 160 48" class="mb-1 w-full opacity-40 transition group-hover:opacity-70">
						<defs>
							<linearGradient id="lc{level.id}" x1="0" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
								<stop offset="0%" stop-color="var(--accent-cyan)" />
								<stop offset="100%" stop-color="var(--accent-purple)" />
							</linearGradient>
						</defs>
						{#each family as { path, scale }, i}
							{#if i === family.length - 1}
								<path d="{path}L160,48L0,48Z" fill="url(#lc{level.id})" opacity="0.08" />
							{/if}
							<path
								d={path}
								fill="none"
								stroke="url(#lc{level.id})"
								stroke-width={i === family.length - 1 ? 1.5 : 0.7}
								opacity={i === family.length - 1 ? 1 : 0.15 + scale * 0.4}
							/>
						{/each}
					</svg>
					<div class="flex items-center gap-1.5">
						<span class="inline-block h-1.5 w-1.5 rounded-full" style="background-color: {getDifficultyColor(level.difficulty)}"></span>
						<span class="text-[12px] font-medium" style="color: var(--text-secondary);">{level.name}</span>
					</div>
				</a>
			{/each}
		</div>
	</div>
</div>
