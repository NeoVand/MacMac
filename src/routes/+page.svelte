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
			t += 0.015;
			drawHero(t);
			animFrame = requestAnimationFrame(animate);
		}

		animate();
		return () => {
			running = false;
			cancelAnimationFrame(animFrame);
		};
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

		// Background
		ctx.clearRect(0, 0, w, h);

		const pad = { x: 40, top: 30, bottom: 20 };
		const pw = w - pad.x * 2;
		const ph = h - pad.top - pad.bottom;

		// Animated mixture distribution
		const m1 = -1.5 + Math.sin(t * 0.7) * 0.3;
		const m2 = 1.5 + Math.cos(t * 0.5) * 0.3;
		const pdf = (x: number) => 0.5 * gaussian(x, m1, 0.7) + 0.5 * gaussian(x, m2, 0.7);

		const xMin = -4, xMax = 4;
		const points = linspace(xMin, xMax, 200);
		const values = points.map(pdf);
		const yMax = Math.max(...values) * 1.15;

		const toX = (x: number) => pad.x + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad.top + ph - (y / yMax) * ph;

		// Animated "sample" dots falling
		const numDots = 12;
		for (let i = 0; i < numDots; i++) {
			const phase = t * 0.8 + i * 2.1;
			const dx = xMin + ((Math.sin(phase * 0.3 + i) * 0.5 + 0.5) * (xMax - xMin));
			const dropProgress = (Math.sin(phase) * 0.5 + 0.5);
			const dotX = toX(dx);
			const targetY = toY(pdf(dx));
			const dotY = pad.top + (targetY - pad.top) * dropProgress;

			const alpha = 0.15 + dropProgress * 0.4;
			ctx.fillStyle = `rgba(255, 140, 50, ${alpha})`;
			ctx.beginPath();
			ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
			ctx.fill();
		}

		// Glow
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(0, 212, 255, 0.2)';
		ctx.lineWidth = 8;
		for (let i = 0; i < points.length; i++) {
			const cx = toX(points[i]);
			const cy = toY(values[i]);
			if (i === 0) ctx.moveTo(cx, cy);
			else ctx.lineTo(cx, cy);
		}
		ctx.stroke();

		// Curve
		ctx.beginPath();
		ctx.strokeStyle = '#00d4ff';
		ctx.lineWidth = 3;
		for (let i = 0; i < points.length; i++) {
			const cx = toX(points[i]);
			const cy = toY(values[i]);
			if (i === 0) ctx.moveTo(cx, cy);
			else ctx.lineTo(cx, cy);
		}
		ctx.stroke();

		// Fill under
		ctx.lineTo(toX(xMax), toY(0));
		ctx.lineTo(toX(xMin), toY(0));
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
		grad.addColorStop(0, 'rgba(0, 212, 255, 0.1)');
		grad.addColorStop(1, 'rgba(0, 212, 255, 0.0)');
		ctx.fillStyle = grad;
		ctx.fill();
	}
</script>

<svelte:head>
	<title>MacMac — The Sampling Game</title>
	<meta
		name="description"
		content="Match probability distributions with the fewest clicks. A game about sampling, intuition, and efficiency."
	/>
</svelte:head>

<div class="flex min-h-dvh flex-col items-center">
	<!-- Hero -->
	<div class="relative flex w-full max-w-2xl flex-col items-center px-4 pt-16 sm:pt-24">
		<!-- Animated canvas behind the title -->
		<canvas
			bind:this={heroCanvas}
			class="absolute inset-0 h-full w-full opacity-40"
			style="pointer-events: none;"
		></canvas>

		<h1
			class="relative z-10 mb-3 text-center text-6xl font-extrabold tracking-tighter text-white sm:text-8xl"
		>
			Mac<span class="text-game-cyan">Mac</span>
		</h1>
		<p class="relative z-10 mb-8 max-w-sm text-center text-base text-white/40">
			See a curve. Click to sample. Match the distribution with the fewest clicks.
		</p>

		<div class="relative z-10 flex gap-3">
			<a
				href="/play/1"
				class="rounded-lg bg-game-cyan px-8 py-3 text-sm font-bold text-game-bg transition hover:scale-105 hover:brightness-110 active:scale-95"
			>
				Play
			</a>
			<a
				href="/leaderboard"
				class="rounded-lg bg-white/[0.06] px-6 py-3 text-sm font-medium text-white/60 transition hover:bg-white/10 hover:text-white/80"
			>
				Leaderboard
			</a>
		</div>
	</div>

	<!-- Levels -->
	<div class="mt-20 w-full max-w-3xl px-4 sm:mt-28">
		<h2 class="mb-5 text-xs font-medium tracking-[0.2em] text-white/20 uppercase">Levels</h2>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{#each levels as level}
				<a
					href="/play/{level.id}"
					class="group relative overflow-hidden rounded-lg bg-white/[0.02] px-4 py-3 transition hover:bg-white/[0.05]"
				>
					<div class="mb-0.5 flex items-center gap-1.5">
						<span
							class="inline-block h-1.5 w-1.5 rounded-full"
							style="background-color: {getDifficultyColor(level.difficulty)}"
						></span>
						<span class="text-[10px] text-white/30 capitalize">{level.difficulty}</span>
					</div>
					<div class="text-sm font-semibold text-white/70 group-hover:text-white">
						{level.name}
					</div>
					<div class="text-[11px] text-white/25">{level.subtitle}</div>
				</a>
			{/each}
		</div>
	</div>

	<!-- How to play -->
	<div class="mt-16 mb-20 w-full max-w-xl px-4">
		<div class="grid grid-cols-3 gap-6 text-center">
			<div>
				<div class="mb-2 text-3xl">1</div>
				<div class="text-xs font-medium text-white/50">See the curve</div>
				<div class="mt-1 text-[10px] leading-relaxed text-white/25">
					A probability density is shown. That's your target.
				</div>
			</div>
			<div>
				<div class="mb-2 text-3xl">2</div>
				<div class="text-xs font-medium text-white/50">Click to sample</div>
				<div class="mt-1 text-[10px] leading-relaxed text-white/25">
					Place points along the axis. A histogram builds in real time.
				</div>
			</div>
			<div>
				<div class="mb-2 text-3xl">3</div>
				<div class="text-xs font-medium text-white/50">Beat the board</div>
				<div class="mt-1 text-[10px] leading-relaxed text-white/25">
					Fewer clicks + lower KL divergence = higher score. Compete globally.
				</div>
			</div>
		</div>
	</div>
</div>
