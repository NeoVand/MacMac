<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import { gaussian, linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import { computeMatchScore, computeTimeBonus } from '$lib/game/scoring';
	import AppHeader from '$lib/components/AppHeader.svelte';

	let canvas: HTMLCanvasElement | undefined = $state();
	let mathContainer: HTMLDivElement | undefined = $state();

	const mseFormula = `$$\\text{MSE} = \\frac{1}{n} \\sum_{i=1}^{n} \\left( \\frac{p(x_i)}{\\max(p)} - \\frac{\\hat{q}(x_i)}{\\max(\\hat{q})} \\right)^2$$`;
	const scoreFormula = `$$\\text{Score} = \\underbrace{\\operatorname{round}\\left( \\frac{8000}{1 + 100 \\cdot \\text{MSE}} \\right)}_{\\text{shape match}} + \\underbrace{\\operatorname{round}\\left( 2000 \\cdot \\max\\left(0, 1 - \\frac{t}{60}\\right) \\right)}_{\\text{time bonus}}$$`;

	const NUM_SAMPLES = 30;
	const SAMPLE_INTERVAL_MS = 200;
	const HOLD_AT_END_MS = 2200;
	const FADE_OUT_MS = 550;
	const START_DELAY_MS = 380;
	const LERP_SPEED = 0.14;
	const FADE_OUT_LERP = 0.22;

	function sampleFromPdf(pdf: (x: number) => number, xMin: number, xMax: number, n: number): number[] {
		const gridSize = 600;
		const xs = linspace(xMin, xMax, gridSize);
		const densities = xs.map(pdf);
		const total = densities.reduce((a, b) => a + b, 0);
		if (total <= 0) return linspace(xMin, xMax, n);
		const samples: number[] = [];
		for (let i = 0; i < n; i++) {
			const u = (i + 0.5) / n;
			let cum = 0;
			for (let j = 0; j < gridSize; j++) {
				cum += densities[j] / total;
				if (cum >= u) {
					samples.push(xs[j]);
					break;
				}
			}
			if (samples.length === i) samples.push(xs[gridSize - 1]);
		}
		return samples;
	}

	function shuffle<T>(arr: T[]): T[] {
		const out = [...arr];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	function computeMse(pVals: number[], qVals: number[]): number {
		const pMax = Math.max(...pVals) || 1;
		const qMax = Math.max(...qVals) || 1;
		let mse = 0;
		for (let i = 0; i < pVals.length; i++) {
			const p = pVals[i] / pMax;
			const q = qMax > 0 ? qVals[i] / qMax : 0;
			mse += (p - q) ** 2;
		}
		return mse / pVals.length;
	}

	let animSampleIdx = 0;
	let animTimer = 0;
	let displayKde: number[] = [];
	let targetKde: number[] = [];
	let animHandle = 0;

	onMount(() => {
		// Double rAF: wait for layout before starting canvas (fixes mobile Safari 0x0 on first paint)
		requestAnimationFrame(() => {
			requestAnimationFrame(() => startVisualAnimation());
		});
		tick().then(() => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					renderMath();
				});
			});
		});
		return () => cancelAnimationFrame(animHandle);
	});

	async function ensureKaTeX(): Promise<void> {
		if (typeof (window as any).renderMathInElement === 'function') return;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('KaTeX load timeout')), 3000);
			const check = () => {
				if (typeof (window as any).renderMathInElement === 'function') {
					clearTimeout(timeout);
					resolve();
					return true;
				}
				return false;
			};
			if (check()) return;
			const interval = setInterval(() => {
				if (check()) {
					clearInterval(interval);
				}
			}, 100);
		});
	}

	async function renderMath() {
		if (!mathContainer) return;
		try {
			await ensureKaTeX();
			const render = (window as any).renderMathInElement;
			if (render && mathContainer) {
				render(mathContainer, {
					delimiters: [
						{ left: '$$', right: '$$', display: true },
						{ left: '\\(', right: '\\)', display: false }
					],
					throwOnError: false
				});
				// Retry after layout settles (fixes mobile Safari timing)
				setTimeout(() => {
					if (render && mathContainer && mathContainer.querySelector('.katex') === null) {
						render(mathContainer, {
							delimiters: [
								{ left: '$$', right: '$$', display: true },
								{ left: '\\(', right: '\\)', display: false }
							],
							throwOnError: false
						});
					}
				}, 300);
			}
		} catch {
			// Fallback: load KaTeX dynamically when layout scripts haven't loaded (mobile)
			loadKaTeXAndRender();
		}
	}

	function loadKaTeXAndRender() {
		if (!mathContainer) return;
		if (typeof (window as any).renderMathInElement === 'function') {
			(window as any).renderMathInElement(mathContainer, {
				delimiters: [
					{ left: '$$', right: '$$', display: true },
					{ left: '\\(', right: '\\)', display: false }
				],
				throwOnError: false
			});
			return;
		}
		const katexCss = document.createElement('link');
		katexCss.rel = 'stylesheet';
		katexCss.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
		katexCss.crossOrigin = 'anonymous';
		document.head.appendChild(katexCss);

		const katexJs = document.createElement('script');
		katexJs.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
		katexJs.crossOrigin = 'anonymous';
		katexJs.onload = () => {
			const autoRender = document.createElement('script');
			autoRender.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';
			autoRender.crossOrigin = 'anonymous';
			autoRender.onload = () => {
				if (mathContainer && typeof (window as any).renderMathInElement === 'function') {
					(window as any).renderMathInElement(mathContainer, {
						delimiters: [
							{ left: '$$', right: '$$', display: true },
							{ left: '\\(', right: '\\)', display: false }
						],
						throwOnError: false
					});
				}
			};
			document.head.appendChild(autoRender);
		};
		document.head.appendChild(katexJs);
	}

	function startVisualAnimation() {
		if (!canvas) return;
		const xMin = -5, xMax = 5.5;
		const pts = linspace(xMin, xMax, 200);
		const pdf = (x: number) =>
			0.25 * gaussian(x, -2.5, 0.6) + 0.45 * gaussian(x, 0.5, 0.9) + 0.3 * gaussian(x, 3, 0.5);

		const allSamples = sampleFromPdf(pdf, xMin, xMax, NUM_SAMPLES);
		const baseCurveKde = computeKDE(allSamples, pts);
		let animOrder = shuffle([...allSamples]);

		displayKde = new Array(pts.length).fill(0);
		targetKde = new Array(pts.length).fill(0);

		let lastTime = performance.now();
		let holdTimer = 0;
		let fadeOutTimer = 0;
		let phase: 'adding' | 'holding' | 'fadingOut' = 'adding';
		let elapsedMs = 0;
		let fadeFactor = 1;
		let frozenStats: { mse: number; score: number; elapsedMs: number } | null = null;

		function frame(now: number) {
			if (!canvas) return;
			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			const dt = Math.min((now - lastTime) / 1000, 0.1);
			lastTime = now;

			if (phase === 'adding') {
				if (animSampleIdx > 0) elapsedMs += dt * 1000;
				animTimer += dt * 1000;
				const interval = animSampleIdx === 0 ? START_DELAY_MS : SAMPLE_INTERVAL_MS;
				if (animTimer >= interval) {
					animTimer = 0;
					animSampleIdx = Math.min(animSampleIdx + 1, animOrder.length);
					if (animSampleIdx >= animOrder.length) {
						phase = 'holding';
						holdTimer = 0;
					}
				}
				targetKde = animSampleIdx > 0 ? computeKDE(animOrder.slice(0, animSampleIdx), pts) : new Array(pts.length).fill(0);
			} else if (phase === 'holding') {
				holdTimer += dt * 1000;
				if (holdTimer >= HOLD_AT_END_MS) {
					phase = 'fadingOut';
					fadeOutTimer = 0;
					frozenStats = {
						mse: computeMse(baseCurveKde, displayKde),
						score: computeMatchScore(computeMse(baseCurveKde, displayKde)) + computeTimeBonus(elapsedMs),
						elapsedMs
					};
				}
				targetKde = computeKDE(animOrder, pts);
			} else {
				fadeOutTimer += dt * 1000;
				targetKde = new Array(pts.length).fill(0);
				for (let i = 0; i < displayKde.length; i++) {
					displayKde[i] += (targetKde[i] - displayKde[i]) * FADE_OUT_LERP;
				}
				fadeFactor = Math.max(0, 1 - fadeOutTimer / FADE_OUT_MS);
				if (fadeOutTimer >= FADE_OUT_MS) {
					animSampleIdx = 0;
					animTimer = 0;
					elapsedMs = 0;
					fadeFactor = 1;
					frozenStats = null;
					phase = 'adding';
					animOrder = shuffle([...allSamples]);
					displayKde = displayKde.map(() => 0);
					targetKde = new Array(pts.length).fill(0);
				}
			}

			if (phase !== 'fadingOut') {
				for (let i = 0; i < displayKde.length; i++) {
					displayKde[i] += (targetKde[i] - displayKde[i]) * LERP_SPEED;
				}
			}

			const currentSamples = phase === 'fadingOut' ? animOrder : animOrder.slice(0, animSampleIdx);
			const mse = computeMse(baseCurveKde, displayKde);
			const stats = frozenStats ?? {
				mse,
				score: computeMatchScore(mse) + computeTimeBonus(elapsedMs),
				elapsedMs
			};

			drawFrame(ctx, pts, xMin, xMax, currentSamples, baseCurveKde, stats, fadeFactor);
			animHandle = requestAnimationFrame(frame);
		}
		animHandle = requestAnimationFrame(frame);
	}

	function drawFrame(
		ctx: CanvasRenderingContext2D,
		pts: number[],
		xMin: number,
		xMax: number,
		currentSamples: number[],
		baseCurveKde: number[],
		stats: { mse: number; score: number; elapsedMs: number },
		fadeFactor: number = 1
	) {
		if (!canvas) return;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		if (w <= 0 || h <= 0) return; // Skip until layout provides dimensions (mobile)
		const dpr = window.devicePixelRatio || 1;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.scale(dpr, dpr);

		const pad = 20;
		const pw = w - pad * 2;
		const ph = h - pad * 2;

		const baseMax = baseCurveKde.length > 0 ? Math.max(...baseCurveKde) : 1;
		const kdeMax = displayKde.length > 0 ? Math.max(...displayKde) : 0;
		const yMax = Math.max(baseMax, kdeMax) * 1.15 || 1;

		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad + ph - (y / yMax) * ph;
		const baseY = toY(0);

		ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#12122a';
		ctx.fillRect(0, 0, w, h);

		// Stats overlay (top left) — compact, elegant
		const tertiary = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || 'rgba(255,255,255,0.35)';
		const secondary = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || 'rgba(255,255,255,0.55)';
		const cyan = getComputedStyle(document.documentElement).getPropertyValue('--accent-cyan').trim() || '#00d4ff';
		const orange = getComputedStyle(document.documentElement).getPropertyValue('--accent-orange').trim() || '#ff9933';
		ctx.font = '500 11px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'top';
		const lineH = 15;
		const statX = pad + 2;
		let statY = pad + 2;
		ctx.fillStyle = tertiary;
		ctx.fillText('MSE ', statX, statY);
		ctx.fillStyle = cyan;
		ctx.fillText(stats.mse.toFixed(4), statX + ctx.measureText('MSE ').width, statY);
		statY += lineH;
		ctx.fillStyle = tertiary;
		ctx.fillText('Time ', statX, statY);
		ctx.fillStyle = secondary;
		ctx.fillText((stats.elapsedMs / 1000).toFixed(1) + 's', statX + ctx.measureText('Time ').width, statY);
		statY += lineH;
		ctx.fillStyle = tertiary;
		ctx.fillText('Score ', statX, statY);
		ctx.fillStyle = orange;
		ctx.fillText(stats.score.toLocaleString(), statX + ctx.measureText('Score ').width, statY);

		// Base curve family (cyan) — KDE of all 30 samples, so it exactly matches when orange fills in
		const scales = linspace(0.25, 1, 16);
		const strokeGrad = ctx.createLinearGradient(toX(xMin), 0, toX(xMax), 0);
		strokeGrad.addColorStop(0, '#00ccff');
		strokeGrad.addColorStop(0.5, '#a855f7');
		strokeGrad.addColorStop(1, '#00ccff');

		for (let si = 0; si < scales.length; si++) {
			const s = scales[si];
			const isMain = si === scales.length - 1;
			const alpha = isMain ? 0.9 : 0.04 + (si / (scales.length - 1)) * 0.5;
			const lw = isMain ? 2 : 0.6 + (si / (scales.length - 1)) * 0.5;
			const vals = baseCurveKde.map((v) => v * s);
			const sp: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i])]);

			if (isMain) {
				ctx.beginPath();
				sp.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(toX(xMax), baseY);
				ctx.lineTo(toX(xMin), baseY);
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

		// KDE curve (orange, builds as samples are added)
		if (currentSamples.length > 0 && displayKde.length === pts.length && fadeFactor > 0.01) {
			ctx.globalAlpha = fadeFactor;
			const clamped = displayKde.map((v) => Math.min(v, yMax * 0.99));
			ctx.beginPath();
			for (let i = 0; i < pts.length; i++) {
				const sy = toY(clamped[i]);
				i === 0 ? ctx.moveTo(toX(pts[i]), sy) : ctx.lineTo(toX(pts[i]), sy);
			}
			ctx.lineTo(toX(pts[pts.length - 1]), baseY);
			ctx.lineTo(toX(pts[0]), baseY);
			ctx.closePath();
			const kdeGrad = ctx.createLinearGradient(0, pad, 0, baseY);
			kdeGrad.addColorStop(0, 'rgba(255, 130, 40, 0.2)');
			kdeGrad.addColorStop(1, 'rgba(255, 100, 30, 0.02)');
			ctx.fillStyle = kdeGrad;
			ctx.fill();

			ctx.beginPath();
			for (let i = 0; i < pts.length; i++) {
				const sy = toY(clamped[i]);
				i === 0 ? ctx.moveTo(toX(pts[i]), sy) : ctx.lineTo(toX(pts[i]), sy);
			}
			ctx.strokeStyle = 'rgba(255, 150, 50, 0.75)';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 3]);
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineCap = 'butt';
			ctx.lineJoin = 'miter';
			ctx.globalAlpha = 1;
		}

		// Sample dots (only those added so far)
		if (fadeFactor > 0.01) {
			ctx.globalAlpha = fadeFactor;
		}
		for (const sx of currentSamples) {
			ctx.fillStyle = 'rgba(255, 150, 50, 0.15)';
			ctx.beginPath();
			ctx.arc(toX(sx), baseY, 6, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = 'rgba(255, 153, 51, 0.65)';
			ctx.beginPath();
			ctx.arc(toX(sx), baseY, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
		if (fadeFactor < 1) ctx.globalAlpha = 1;
	}
</script>

<svelte:head>
	<title>About — macmac</title>
</svelte:head>

<div class="min-h-dvh">
	<AppHeader activePage="about" />

	<div bind:this={mathContainer} class="mx-auto max-w-xl px-4 sm:px-6">
	<canvas
		bind:this={canvas}
		class="mt-6 h-32 min-h-[128px] w-full rounded-3xl sm:h-40 sm:min-h-[160px]"
		style="background: var(--surface);"
	></canvas>

	<h1 class="mt-6 mb-5 text-xl font-bold" style="font-family: 'Space Grotesk', sans-serif; color: var(--text-primary);">
		About <span style="color: var(--text-primary); opacity: 0.8;">mac</span><span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-transparent">mac</span>
	</h1>

	<div class="space-y-4 text-[13px] leading-relaxed" style="color: var(--text-secondary);">
		<p>
			<strong style="color: var(--text-primary); opacity: 0.65;">macmac</strong> is a game that builds intuition for
			<a href="https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo" target="_blank" rel="noopener" class="underline transition hover:opacity-80" style="color: var(--accent-cyan); opacity: 0.7; text-decoration-color: color-mix(in srgb, var(--accent-cyan) 25%, transparent);">Markov Chain Monte Carlo (MCMC)</a>
			— one of the most important ideas in computational statistics and machine learning.
		</p>

		<p>
			In MCMC, the goal is to draw samples from a probability distribution. The challenge is doing it
			<em style="color: var(--text-primary); opacity: 0.75;">efficiently</em> — capturing the shape of a distribution with as few samples as possible.
			That's exactly what you're doing in this game.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">How it works</h2>

		<p>
			Each level shows a target probability density function {@html '\\(p(x)\\)'}. You click to place samples.
			As you add points, a
			<a href="https://en.wikipedia.org/wiki/Kernel_density_estimation" target="_blank" rel="noopener" class="underline transition hover:opacity-80" style="color: var(--accent-cyan); opacity: 0.7;">kernel density estimate</a>
			{@html '\\(\\hat{q}(x)\\)'} builds up to show what your samples imply about the underlying distribution.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">Scoring</h2>

		<p>Your score is based on two factors: how accurately your samples match the target distribution, and how efficiently you placed them.</p>

		<p>
			<strong style="color: var(--text-primary); opacity: 0.55;">Shape match</strong> is measured by the mean squared error between the target PDF and your KDE, both normalized to the same peak height. This compares the visual shape directly:
		</p>

		<div class="formula-box overflow-x-auto rounded-3xl px-4 py-3 sm:overflow-visible" style="background: var(--surface);">
			{@html mseFormula}
		</div>

		<p>
			where {@html '\\(p(x)\\)'} is the target density and {@html '\\(\\hat{q}(x)\\)'} is the KDE from your samples. Both are scaled so their peak equals 1, then compared point by point. If the curves look the same, MSE is near zero.
		</p>

		<p>
			<strong style="color: var(--text-primary); opacity: 0.55;">Time bonus</strong> rewards speed. A fast solution earns up to 2,000 extra points, dropping continuously to zero over 60 seconds.
		</p>

		<p>The final score:</p>

		<div class="formula-box overflow-x-auto rounded-3xl px-4 py-3 sm:overflow-visible" style="background: var(--surface);">
			{@html scoreFormula}
		</div>

		<p>
			The shape match component (up to 8,000) measures how well your curve fits the target. The time bonus (up to 2,000) rewards efficiency — there is no explicit click penalty, but more clicks take more time. The tension: speed versus precision.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">Why it matters</h2>

		<p>
			MCMC methods are used everywhere — from
			<a href="https://en.wikipedia.org/wiki/Bayesian_inference" target="_blank" rel="noopener" class="underline transition hover:opacity-80" style="color: var(--accent-cyan); opacity: 0.7;">Bayesian inference</a>
			to protein folding to language models.
			The core question is always the same: how can we represent a complex distribution with a
			finite set of samples? This game lets you experience that question firsthand.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">Generated levels</h2>

		<p>
			Every time you visit the home page, you see a fresh grid of procedurally generated levels.
			Each level is created from a seed using a deterministic algorithm — the difficulty rating (1 to 10)
			directly controls the number of peaks, how closely they overlap, how unequal they are, and how much
			noise is added. Simple levels (1&#8211;2) have a single clean peak; hard levels (7+) have many overlapping
			modes with noise.
		</p>

		<p>
			The grid adapts to your skill. As you play more, levels center around your player rating so you
			always face an appropriate challenge. You get 3 resets per level — after that, you can regenerate
			a fresh level at the same difficulty.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">Weighted scoring</h2>

		<p>
			Your raw score (shape match + time bonus) is scaled by the level's difficulty:
			{@html '\\(\\text{weighted} = \\text{raw} \\times \\frac{d}{3}\\)'}
			where {@html '\\(d\\)'} is the difficulty rating. Medium levels ({@html '\\(d \\approx 3\\)'})
			get a 1&#215; multiplier; harder levels reward proportionally more.
		</p>

		<p>
			Your <strong style="color: var(--text-primary); opacity: 0.55;">player rating</strong> is an
			exponential moving average of your performance across difficulties — it tracks what difficulty you
			can handle well. The leaderboard ranks players by their best weighted score and by rating.
		</p>

		<h2 class="pt-2 text-sm font-semibold" style="color: var(--text-primary); opacity: 0.6;">Battle mode</h2>

		<p>
			Battle mode is real-time 1v1. Both players receive the same generated level and have
			<strong style="color: var(--text-primary); opacity: 0.55;">20 seconds</strong> to match the target
			distribution. You can see your opponent's KDE building as a shadow curve — but not their click positions.
		</p>

		<p>
			If either player reaches <strong style="color: var(--text-primary); opacity: 0.55;">98% accuracy</strong>
			before time runs out, they trigger a jackpot and win instantly. Otherwise, the higher score wins.
			Battle results update your
			<a href="https://en.wikipedia.org/wiki/Elo_rating_system" target="_blank" rel="noopener" class="underline transition hover:opacity-80" style="color: var(--accent-cyan); opacity: 0.7;">ELO rating</a>
			(K=32, starting at 1200). Matchmaking pairs players with similar ELO.
		</p>

		<!-- Footer -->
		<div class="mt-10 mb-16 flex flex-col gap-4 rounded-2xl px-5 py-6 sm:px-6 sm:py-7" style="background: var(--surface); border: 1px solid var(--border);">
			<div class="text-sm" style="color: var(--text-tertiary);">
				Created by <span style="color: var(--text-secondary);">Neo Mohsenvand</span>
			</div>
			<div class="flex flex-wrap gap-5">
				<a href="https://github.com/NeoVand/MacMac" target="_blank" rel="noopener" class="flex items-center gap-2 text-sm transition hover:opacity-80" style="color: var(--text-secondary);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0020 10.017C20 4.484 15.522 0 10 0z" clip-rule="evenodd" /></svg>
					GitHub
				</a>
				<a href="https://en.wikipedia.org/wiki/Markov_chain_Monte_Carlo" target="_blank" rel="noopener" class="flex items-center gap-2 text-sm transition hover:opacity-80" style="color: var(--text-secondary);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5zm7.5-3a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0V4.06l-6.22 6.22a.75.75 0 11-1.06-1.06l6.22-6.22H12.5a.75.75 0 01-.75-.75z" clip-rule="evenodd" /></svg>
					MCMC on Wikipedia
				</a>
			</div>
		</div>
	</div>
	</div>
</div>

<style>
	:global(.katex) {
		color: var(--text-primary);
		opacity: 0.7;
		font-size: 1.05em;
	}
	:global(.katex .mord.text) {
		opacity: 0.6;
	}
	/* Scale down equations on mobile to avoid horizontal scroll */
	.formula-box :global(.katex) {
		font-size: 0.7em;
	}
	@media (min-width: 400px) {
		.formula-box :global(.katex) {
			font-size: 0.85em;
		}
	}
	@media (min-width: 640px) {
		.formula-box :global(.katex) {
			font-size: 1.05em;
		}
	}
</style>
