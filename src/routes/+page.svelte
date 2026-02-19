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

		const pathPts: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i])]);

		ctx.beginPath();
		ctx.moveTo(pathPts[0][0], pathPts[0][1]);
		for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
		ctx.lineTo(toX(xMax), toY(0));
		ctx.lineTo(toX(xMin), toY(0));
		ctx.closePath();
		const fillGrad = ctx.createLinearGradient(0, padTop, 0, padTop + ph);
		fillGrad.addColorStop(0, 'rgba(0, 200, 255, 0.12)');
		fillGrad.addColorStop(0.5, 'rgba(120, 60, 230, 0.06)');
		fillGrad.addColorStop(1, 'rgba(0, 200, 255, 0.0)');
		ctx.fillStyle = fillGrad;
		ctx.fill();

		ctx.beginPath();
		ctx.moveTo(pathPts[0][0], pathPts[0][1]);
		for (let i = 1; i < pathPts.length; i++) ctx.lineTo(pathPts[i][0], pathPts[i][1]);
		ctx.strokeStyle = 'rgba(0, 200, 255, 0.08)';
		ctx.lineWidth = 12;
		ctx.stroke();

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
	<div class="relative flex w-full max-w-2xl flex-col items-center px-4 pt-14 sm:pt-20">
		<canvas
			bind:this={heroCanvas}
			class="absolute inset-0 h-full w-full opacity-50"
			style="pointer-events: none;"
		></canvas>

		<h1 class="relative z-10 mb-2 text-center" style="font-family: 'Space Grotesk', sans-serif;">
			<span class="text-6xl tracking-tight text-white/90 sm:text-8xl">mac</span><span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-6xl tracking-tight text-transparent sm:text-8xl">mac</span>
		</h1>
		<p class="relative z-10 mb-7 max-w-xs text-center text-[13px] leading-relaxed text-white/30 sm:text-sm">
			See a curve. Click to sample. Match the shape with the fewest clicks.
		</p>

		<div class="relative z-10 flex gap-2.5">
			<a
				href="/play/1"
				class="flex h-10 items-center gap-2 rounded-lg border border-game-cyan/30 bg-game-cyan/10 px-5 text-[13px] font-semibold text-game-cyan transition hover:border-game-cyan/50 hover:bg-game-cyan/15"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
				Play
			</a>
			<a
				href="/leaderboard"
				class="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-[13px] font-medium text-white/50 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white/70"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684zM13.949 13.684a1 1 0 00-1.898 0l-.184.551a1 1 0 01-.632.633l-.551.183a1 1 0 000 1.898l.551.183a1 1 0 01.633.633l.183.551a1 1 0 001.898 0l.184-.551a1 1 0 01.632-.633l.551-.183a1 1 0 000-1.898l-.551-.184a1 1 0 01-.633-.632l-.183-.551z" /></svg>
				Leaderboard
			</a>
			<a
				href="/about"
				class="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-[13px] font-medium text-white/50 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white/70"
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>
				About
			</a>
		</div>
	</div>

	<!-- Steps -->
	<div class="mt-10 flex w-full max-w-sm justify-center gap-8 px-4 sm:mt-12">
		<div class="text-center">
			<div class="mb-0.5 font-mono text-sm text-white/10">01</div>
			<div class="text-[11px] text-white/30">See the curve</div>
		</div>
		<div class="text-center">
			<div class="mb-0.5 font-mono text-sm text-white/10">02</div>
			<div class="text-[11px] text-white/30">Click to sample</div>
		</div>
		<div class="text-center">
			<div class="mb-0.5 font-mono text-sm text-white/10">03</div>
			<div class="text-[11px] text-white/30">Beat the board</div>
		</div>
	</div>

	<!-- Levels -->
	<div class="mt-10 w-full max-w-3xl px-4 pb-16 sm:mt-12">
		<h2 class="mb-4 text-[10px] font-medium tracking-[0.2em] text-white/15 uppercase">Levels</h2>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each levels as level}
				{@const path = levelSvgPath(level, 160, 48)}
				<a
					href="/play/{level.id}"
					class="group overflow-hidden rounded-xl bg-white/[0.02] p-3 transition hover:bg-white/[0.05]"
				>
					<svg viewBox="0 0 160 48" class="mb-1.5 w-full opacity-30 transition group-hover:opacity-60">
						<defs>
							<linearGradient id="lc{level.id}" x1="0" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
								<stop offset="0%" stop-color="#00ccff" />
								<stop offset="100%" stop-color="#a855f7" />
							</linearGradient>
						</defs>
						<path d="{path}L160,48L0,48Z" fill="url(#lc{level.id})" opacity="0.08" />
						<path d={path} fill="none" stroke="url(#lc{level.id})" stroke-width="1.5" />
					</svg>
					<div class="flex items-center gap-1.5">
						<span class="inline-block h-1.5 w-1.5 rounded-full" style="background-color: {getDifficultyColor(level.difficulty)}"></span>
						<span class="text-[13px] font-medium text-white/45 group-hover:text-white/80">{level.name}</span>
					</div>
				</a>
			{/each}
		</div>
	</div>
</div>
