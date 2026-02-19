<script lang="ts">
	import { onMount } from 'svelte';
	import { gaussian, linspace } from '$lib/game/math';

	let canvas: HTMLCanvasElement | undefined = $state();
	let mathContainer: HTMLDivElement | undefined = $state();

	const klFormula = `$$D_{\\mathrm{KL}}(P \\,\\|\\, Q) = \\sum_{i=1}^{k} P(x_i) \\, \\ln \\frac{P(x_i)}{Q(x_i)}$$`;
	const scoreFormula = `$$\\text{Score} = \\left\\lfloor \\frac{10000}{\\underbrace{(1 + 10 \\cdot D_{\\mathrm{KL}})}_{\\text{accuracy}} \\;\\cdot\\; \\underbrace{\\left(1 + \\dfrac{N}{100}\\right)}_{\\text{clicks}}} \\right\\rfloor$$`;

	onMount(() => {
		if (canvas) drawVisual();
		renderMath();
	});

	async function renderMath() {
		// Wait for KaTeX to load from CDN
		const check = () => typeof (window as any).renderMathInElement === 'function';
		if (!check()) {
			await new Promise<void>((resolve) => {
				const interval = setInterval(() => {
					if (check()) { clearInterval(interval); resolve(); }
				}, 100);
				setTimeout(() => { clearInterval(interval); resolve(); }, 3000);
			});
		}
		if (mathContainer && check()) {
			(window as any).renderMathInElement(mathContainer, {
				delimiters: [
					{ left: '$$', right: '$$', display: true },
					{ left: '\\(', right: '\\)', display: false }
				],
				throwOnError: false
			});
		}
	}

	function drawVisual() {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.scale(dpr, dpr);

		const pad = 20;
		const pw = w - pad * 2;
		const ph = h - pad * 2;

		const pdf = (x: number) =>
			0.25 * gaussian(x, -2.5, 0.6) + 0.45 * gaussian(x, 0.5, 0.9) + 0.3 * gaussian(x, 3, 0.5);

		const xMin = -5, xMax = 5.5;
		const pts = linspace(xMin, xMax, 300);
		const vals = pts.map(pdf);
		const yMax = Math.max(...vals) * 1.15;

		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad + ph - (y / yMax) * ph;

		const pathPts: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i])]);

		// Family of curves
		const scales = [0.5, 0.7, 0.85, 1.0];
		const strokeGrad = ctx.createLinearGradient(toX(xMin), 0, toX(xMax), 0);
		strokeGrad.addColorStop(0, '#00ccff');
		strokeGrad.addColorStop(0.5, '#a855f7');
		strokeGrad.addColorStop(1, '#00ccff');

		for (let si = 0; si < scales.length; si++) {
			const s = scales[si];
			const alpha = si === scales.length - 1 ? 0.9 : 0.1 + si * 0.06;
			const lw = si === scales.length - 1 ? 2 : 1;
			const sp: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i] * s)]);

			if (si === scales.length - 1) {
				ctx.beginPath();
				sp.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(toX(xMax), toY(0));
				ctx.lineTo(toX(xMin), toY(0));
				ctx.closePath();
				const g = ctx.createLinearGradient(0, pad, 0, pad + ph);
				g.addColorStop(0, 'rgba(0, 200, 255, 0.08)');
				g.addColorStop(1, 'rgba(0, 200, 255, 0.0)');
				ctx.fillStyle = g;
				ctx.fill();
			}

			ctx.beginPath();
			sp.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = strokeGrad;
			ctx.lineWidth = lw;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		const baseY = toY(0);
		const sampleXs = [-3, -2.8, -2.3, -2, -1, 0, 0.2, 0.5, 0.7, 1, 1.3, 2.5, 2.8, 3, 3.2, 3.5];
		for (const sx of sampleXs) {
			ctx.fillStyle = 'rgba(255, 153, 51, 0.5)';
			ctx.beginPath();
			ctx.arc(toX(sx), baseY, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
	}
</script>

<svelte:head>
	<title>About — macmac</title>
	<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous" />
	<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossorigin="anonymous"></script>
	<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" crossorigin="anonymous"></script>
</svelte:head>

<div bind:this={mathContainer} class="mx-auto min-h-dvh max-w-xl px-6 py-8 sm:px-10 sm:py-12">
	<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
		<span class="text-sm text-white/50">mac</span><span class="text-sm text-game-cyan/50">mac</span>
	</a>

	<canvas
		bind:this={canvas}
		class="mt-6 h-32 w-full rounded-xl sm:h-40"
		style="background: linear-gradient(135deg, rgba(17,17,48,0.5), rgba(8,8,22,0.8));"
	></canvas>

	<h1 class="mt-6 mb-5 text-xl font-bold text-white" style="font-family: 'Space Grotesk', sans-serif;">
		About <span class="text-white/80">mac</span><span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-transparent">mac</span>
	</h1>

	<div class="space-y-4 text-[13px] leading-relaxed text-white/40">
		<p>
			<strong class="text-white/65">macmac</strong> is a game that builds intuition for
			<a href="https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo" target="_blank" rel="noopener" class="text-game-cyan/60 underline decoration-game-cyan/20 transition hover:text-game-cyan/80">Markov Chain Monte Carlo (MCMC)</a>
			— one of the most important ideas in computational statistics and machine learning.
		</p>

		<p>
			In MCMC, the goal is to draw samples from a probability distribution. The challenge is doing it
			<em class="text-white/50">efficiently</em> — capturing the shape of a distribution with as few samples as possible.
			That's exactly what you're doing in this game.
		</p>

		<h2 class="pt-2 text-sm font-semibold text-white/55">How it works</h2>

		<p>
			Each level shows a target probability density function {@html '\\(p(x)\\)'}. You click to place samples.
			As you add points, a
			<a href="https://en.wikipedia.org/wiki/Kernel_density_estimation" target="_blank" rel="noopener" class="text-game-cyan/60 underline decoration-game-cyan/20 transition hover:text-game-cyan/80">kernel density estimate</a>
			{@html '\\(\\hat{q}(x)\\)'} builds up to show what your samples imply about the underlying distribution.
		</p>

		<h2 class="pt-2 text-sm font-semibold text-white/55">Scoring</h2>

		<p>Your score is based on two factors: how accurately your samples match the target distribution, and how efficiently you placed them.</p>

		<p>
			<strong class="text-white/50">Accuracy</strong> is measured by the
			<a href="https://en.wikipedia.org/wiki/Kullback%E2%80%93Leibler_divergence" target="_blank" rel="noopener" class="text-game-cyan/60 underline decoration-game-cyan/20 transition hover:text-game-cyan/80">Kullback–Leibler divergence</a>
			from the true distribution \(P\) to the empirical distribution \(Q\):
		</p>

		<div class="overflow-x-auto rounded-lg bg-white/[0.03] px-4 py-3">
			{@html klFormula}
		</div>

		<p>
			where the distributions are discretized into {@html '\\(k\\)'} bins, {@html '\\(P(x_i)\\)'} is the true density in bin {@html '\\(i\\)'}, and {@html '\\(Q(x_i)\\)'} is the empirical density with Laplace smoothing. Lower KL divergence means a better match.
		</p>

		<p>
			<strong class="text-white/50">Efficiency</strong> is captured by a diminishing-returns factor. Each additional click helps your accuracy but costs you efficiency.
		</p>

		<p>The final score combines both:</p>

		<div class="overflow-x-auto rounded-lg bg-white/[0.03] px-4 py-3">
			{@html scoreFormula}
		</div>

		<p>
			Both penalties are multiplicative — bad accuracy can't be rescued by few clicks, and many clicks can't rescue a poor match. KL divergence dominates: a 10x improvement in KL matters far more than halving your clicks. The click penalty is mild ({@html '\\(N/100\\)'}) so that strategy, not speed, determines the score.
		</p>

		<h2 class="pt-2 text-sm font-semibold text-white/55">Why it matters</h2>

		<p>
			MCMC methods are used everywhere — from
			<a href="https://en.wikipedia.org/wiki/Bayesian_inference" target="_blank" rel="noopener" class="text-game-cyan/60 underline decoration-game-cyan/20 transition hover:text-game-cyan/80">Bayesian inference</a>
			to protein folding to language models.
			The core question is always the same: how can we represent a complex distribution with a
			finite set of samples? This game lets you experience that question firsthand.
		</p>

		<!-- Footer -->
		<div class="mt-6 flex flex-col gap-3 border-t border-white/5 pt-5">
			<div class="text-xs text-white/25">
				Created by <span class="text-white/45">Neo Mohsenvand</span>
			</div>
			<div class="flex gap-4">
				<a href="https://github.com/NeoVand/MacMac" target="_blank" rel="noopener" class="flex items-center gap-1.5 text-xs text-white/25 transition hover:text-white/55">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path fill-rule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0020 10.017C20 4.484 15.522 0 10 0z" clip-rule="evenodd" /></svg>
					GitHub
				</a>
				<a href="https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo" target="_blank" rel="noopener" class="flex items-center gap-1.5 text-xs text-white/25 transition hover:text-white/55">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.5-3a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V4.06l-6.22 6.22a.75.75 0 11-1.06-1.06l6.22-6.22H12.5a.75.75 0 01-.75-.75z" clip-rule="evenodd" /></svg>
					MCMC on Wikipedia
				</a>
			</div>
		</div>
	</div>
</div>

<style>
	:global(.katex) {
		color: rgba(255, 255, 255, 0.7);
		font-size: 1.05em;
	}
	:global(.katex .mord.text) {
		color: rgba(255, 255, 255, 0.5);
	}
</style>
