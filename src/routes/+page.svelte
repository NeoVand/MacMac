<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { gaussian, linspace } from '$lib/game/math';
	import { generateGrid, generateReplacement, gridConfigForRating } from '$lib/game/grid';
	import type { GeneratedLevel } from '$lib/game/generator';
	import { fetchBattleQueueCount } from '$lib/battle/client';
	import { battleQueue, startQueue, cancelQueue } from '$lib/stores/battle-queue';
	import { authClient } from '$lib/auth-client';
	import LevelTile from '$lib/components/LevelTile.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import SoundButton from '$lib/components/SoundButton.svelte';
	import { computeSkillLevel, getSkillTier } from '$lib/game/rating';
	import { getBattleTier } from '$lib/game/elo';
	import { Github, Linkedin, Sword, Swords } from 'lucide-svelte';
	import { resolvePlayerName } from '$lib/utils/player-name';
	import RankingsModal from '$lib/components/RankingsModal.svelte';

	let { data } = $props();
	let showRankings = $state(false);
	const session = authClient.useSession();

	// --- Live battle search indicator (HTTP poll) ---
	let battleSearching = $state(0);

	onMount(() => {
		let active = true;
		async function poll() {
			if (!active) return;
			battleSearching = await fetchBattleQueueCount();
			if (active) setTimeout(poll, 10_000);
		}
		poll();
		return () => { active = false; };
	});

	// --- Battle queue (global store) ---
	function handleBattleClick() {
		const playerId = $session.data?.user?.id ?? `anon-${Date.now()}`;
		const playerName = resolvePlayerName($session.data?.user?.name ?? 'Anonymous');
		const battleElo = data.battleElo ?? 1200;
		const country = data.country ?? null;
		startQueue(playerId, playerName, battleElo, country);
	}

	function handleCancelQueue() {
		cancelQueue();
	}

	// When the user leaves the queue (cancel, match, etc.), the polled
	// battleSearching still includes them until the next HTTP cycle.
	// Immediately decrement to avoid the "ghost self" badge.
	let wasInQueue = false;
	$effect(() => {
		const inQueue = $battleQueue.status !== 'idle' && $battleQueue.status !== 'match_found';
		if (wasInQueue && !inQueue) {
			battleSearching = Math.max(0, battleSearching - 1);
			setTimeout(() => fetchBattleQueueCount().then(c => { battleSearching = c; }), 1500);
		}
		wasInQueue = inQueue;
	});

	// --- Grid state ---
	const GRID_KEY = 'macmac_grid_seed';
	const COMPLETED_KEY = 'macmac_completed';

	let gridLevels = $state<GeneratedLevel[]>([]);
	let mounted = $state(false);

	function getBaseSeed(): number {
		return Date.now();
	}

	function getCompletedSeeds(): Set<number> {
		if (typeof sessionStorage === 'undefined') return new Set();
		const stored = sessionStorage.getItem(COMPLETED_KEY);
		if (!stored) return new Set();
		try {
			return new Set(JSON.parse(stored) as number[]);
		} catch {
			return new Set();
		}
	}

	function saveCompletedSeeds(seeds: Set<number>) {
		if (typeof sessionStorage === 'undefined') return;
		sessionStorage.setItem(COMPLETED_KEY, JSON.stringify([...seeds]));
	}

	function buildGrid() {
		const baseSeed = getBaseSeed();
		const config = gridConfigForRating(data.playerRating);
		let levels = generateGrid(baseSeed, config);

		// Replace any previously completed levels
		const completed = getCompletedSeeds();
		if (completed.size > 0) {
			levels = levels.map((lvl, i) => {
				if (completed.has(lvl.seed)) {
					return generateReplacement(data.playerRating ?? 0, i);
				}
				return lvl;
			});
		}

		return levels;
	}

	function playSolo() {
		if (gridLevels.length === 0) return;
		const pick = gridLevels[Math.floor(Math.random() * gridLevels.length)];
		goto(`/play/${pick.id}`);
	}

	onMount(() => {
		gridLevels = buildGrid();
		mounted = true;

		// Auto-start battle queue if navigated with ?battle
		if (page.url.searchParams.has('battle')) {
			replaceState('/', {});
			handleBattleClick();
		}
	});

	// --- Hero animation ---
	let heroCanvas: HTMLCanvasElement | undefined = $state();
	let animFrame = 0;
	let heroColors = {
		accentCyan: '#00d4ff',
		accentPurple: '#a855f7',
		curveGlow: 'rgba(0,200,255,0.12)',
		curveFillStart: 'rgba(0,200,255,0.07)',
		curveFillEnd: 'rgba(0,200,255,0.0)'
	};

	function refreshHeroColors() {
		const s = getComputedStyle(document.documentElement);
		const v = (n: string) => s.getPropertyValue(n).trim();
		heroColors = {
			accentCyan: v('--accent-cyan'),
			accentPurple: v('--accent-purple'),
			curveGlow: v('--curve-glow'),
			curveFillStart: v('--curve-fill-start'),
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
			const isMobile = heroCanvas.clientWidth < 640;
			t += isMobile ? 0.02 : 0.012;
			drawHero(t, isMobile);
			animFrame = requestAnimationFrame(animate);
		}
		requestAnimationFrame(() => {
			requestAnimationFrame(() => animate());
		});
		return () => {
			running = false;
			cancelAnimationFrame(animFrame);
			observer.disconnect();
		};
	});

	function drawHero(t: number, isMobile = false) {
		if (!heroCanvas) return;
		const ctx = heroCanvas.getContext('2d');
		if (!ctx) return;

		const w = heroCanvas.clientWidth;
		const h = heroCanvas.clientHeight;
		if (w <= 0 || h <= 0) return;
		const dpr = isMobile ? Math.min(window.devicePixelRatio || 1, 2) : (window.devicePixelRatio || 1);
		heroCanvas.width = w * dpr;
		heroCanvas.height = h * dpr;
		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, w, h);

		const padX = 0;
		const padTop = 10,
			padBot = 6;
		const pw = w;
		const ph = h - padTop - padBot;
		const fadeW = w < 640 ? 40 : 80;

		const m1 = -2.5 + Math.sin(t * 0.4) * 0.5;
		const m2 = -1.0 + Math.sin(t * 0.6 + 1.2) * 0.4;
		const m3 = 0.3 + Math.sin(t * 0.7 + 1.5) * 0.35;
		const m4 = 1.5 + Math.cos(t * 0.5 + 2.5) * 0.4;
		const m5 = 2.8 + Math.cos(t * 0.3 + 3) * 0.45;
		const s1 = 0.5 + Math.sin(t * 0.5) * 0.1;
		const s2 = 0.6 + Math.cos(t * 0.45 + 0.8) * 0.12;
		const s3 = 0.7 + Math.cos(t * 0.6) * 0.15;
		const s4 = 0.55 + Math.sin(t * 0.55 + 1.8) * 0.1;
		const s5 = 0.45 + Math.sin(t * 0.8 + 2) * 0.08;

		const amplitude = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 0.18));
		const pdf = (x: number) =>
			amplitude *
			(0.18 * gaussian(x, m1, s1) + 0.22 * gaussian(x, m2, s2) + 0.25 * gaussian(x, m3, s3) + 0.20 * gaussian(x, m4, s4) + 0.15 * gaussian(x, m5, s5));

		const xMin = -4,
			xMax = 4;
		const numPts = 150;
		const pts = linspace(xMin, xMax, numPts);
		const vals = pts.map(pdf);
		const yMax = Math.max(...vals) * 1.0;

		const toX = (x: number) => padX + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => padTop + ph - (y / yMax) * ph;

		const accentCyan = heroColors.accentCyan;
		const accentPurple = heroColors.accentPurple;

		const numScales = isMobile ? 8 : 12;
		const scales = linspace(0.15, 1, numScales);
		const strokeGrad = ctx.createLinearGradient(toX(xMin), 0, toX(xMax), 0);
		strokeGrad.addColorStop(0, accentCyan);
		strokeGrad.addColorStop(0.5, accentPurple);
		strokeGrad.addColorStop(1, accentCyan);

		for (let si = 0; si < scales.length; si++) {
			const s = scales[si];
			const alpha =
				si === scales.length - 1 ? 1.0 : 0.12 + (si / (scales.length - 1)) * 0.5;
			const lineW =
				si === scales.length - 1 ? 2.5 : 0.8 + (si / (scales.length - 1)) * 0.6;
			const scaledPts: [number, number][] = pts.map((x, i) => [toX(x), toY(vals[i] * s)]);

			if (si === scales.length - 1) {
				ctx.beginPath();
				scaledPts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
				ctx.lineTo(toX(xMax), toY(0));
				ctx.lineTo(toX(xMin), toY(0));
				ctx.closePath();
				const fillGrad = ctx.createLinearGradient(0, padTop, 0, padTop + ph);
				fillGrad.addColorStop(0, heroColors.curveFillStart);
				fillGrad.addColorStop(1, heroColors.curveFillEnd);
				ctx.fillStyle = fillGrad;
				ctx.fill();

				ctx.beginPath();
				scaledPts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
				ctx.strokeStyle = heroColors.curveGlow;
				ctx.lineWidth = isMobile ? 8 : 12;
				ctx.stroke();
			}

			ctx.beginPath();
			scaledPts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = strokeGrad;
			ctx.lineWidth = lineW;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		// Edge fade: draw a gradient mask using destination-in compositing
		ctx.save();
		ctx.globalCompositeOperation = 'destination-in';
		const fadeGrad = ctx.createLinearGradient(0, 0, w, 0);
		fadeGrad.addColorStop(0, 'rgba(0,0,0,0)');
		fadeGrad.addColorStop(fadeW / w, 'rgba(0,0,0,1)');
		fadeGrad.addColorStop(1 - fadeW / w, 'rgba(0,0,0,1)');
		fadeGrad.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = fadeGrad;
		ctx.fillRect(0, 0, w, h);
		ctx.restore();
	}
</script>

<svelte:head>
	<title>macmac — The Sampling Game</title>
	<meta
		name="description"
		content="Match probability distributions with the fewest clicks. A game about sampling, intuition, and efficiency."
	/>
	<meta property="og:title" content="macmac — The Sampling Game" />
	<meta
		property="og:description"
		content="Match probability distributions with the fewest clicks. A game about MCMC intuition."
	/>
	<meta property="og:url" content="https://macmac-gilt.vercel.app" />
</svelte:head>

<div class="relative flex min-h-dvh flex-col items-center overflow-hidden">
	<!-- Ambient floating orbs -->
	<div class="ambient-orb ambient-orb-1"></div>
	<div class="ambient-orb ambient-orb-2"></div>
	<div class="ambient-orb ambient-orb-3"></div>

	<div class="relative z-20 w-full shrink-0">
		<AppHeader />
	</div>

	<!-- Main content -->
	<div class="flex w-full flex-1 flex-col items-center justify-center">
		<!-- Hero: animation + logo + subtext -->
		<div
			class="relative flex h-[180px] w-full flex-col items-center justify-end pb-2 sm:h-[220px]"
		>
			<canvas
				bind:this={heroCanvas}
				class="absolute inset-0 h-full w-full opacity-50"
				style="pointer-events: none;"
			></canvas>
			<div class="relative z-10 flex flex-col items-center justify-center px-4">
				<h1
					class="mb-1 text-center sm:mb-2"
					style="font-family: 'Believe Stronger', sans-serif;"
				>
					<span
						class="text-8xl tracking-tight sm:text-9xl"
						style="color: var(--text-primary); opacity: 0.85;">Mac</span
					><span
						class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-8xl tracking-tight text-transparent sm:text-9xl"
						>Mac</span
					>
				</h1>
				<p
					class="mb-0 text-center text-[10px] font-semibold uppercase tracking-[0.3em] sm:text-xs"
					style="color: var(--text-tertiary);"
				>
					the sampling game
				</p>
			</div>
		</div>

		<!-- Rank badges for signed-in players (clickable → opens rankings modal) -->
		{#if (data.gamesPlayed > 0 && data.playerRating !== null) || (data.battlesPlayed > 0 && data.battleElo !== null)}
			<button onclick={() => showRankings = true} class="flex cursor-pointer items-center justify-center gap-4 rounded-xl px-4 py-1 transition hover:opacity-80" style="background: transparent;" title="View Rankings">
				{#if data.gamesPlayed > 0 && data.playerRating !== null}
					{@const skillLevel = computeSkillLevel(data.playerRating)}
					{@const tier = getSkillTier(skillLevel)}
					<div class="flex items-center gap-1.5">
						<RankBadge mode="solo" value={skillLevel} size="md" />
						<span class="text-sm font-bold tabular-nums" style="color: {tier.color};">{skillLevel.toLocaleString()}</span>
					</div>
				{/if}
				{#if data.battlesPlayed > 0 && data.battleElo !== null}
					{@const bTier = getBattleTier(data.battleElo)}
					<div class="flex items-center gap-1.5">
						<RankBadge mode="battle" value={data.battleElo} size="md" />
						<span class="text-sm font-bold tabular-nums" style="color: {bTier.color};">{data.battleElo}</span>
					</div>
				{/if}
			</button>
		{:else if !$session.data?.user}
			<button onclick={() => showRankings = true} class="cursor-pointer rounded-lg px-3 py-1 text-[11px] font-medium transition hover:opacity-70" style="color: var(--text-tertiary); background: transparent;" title="View Rankings">
				Sign in to get ranked
			</button>
		{/if}

		<!-- Buttons: Solo + Battle + Leaderboard (uses .btn-action from layout.css) -->
		<div class="flex w-full justify-center px-4 pt-3 pb-6">
			<div class="flex flex-nowrap items-center justify-center gap-3 sm:gap-3">
				<button onclick={playSolo} class="btn-action" style="--btn-color: var(--accent-cyan);" title="Play a random level">
					<span class="btn-action-face">
						<Sword class="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} />
						Solo
					</span>
				</button>
				{#if $battleQueue.status !== 'idle' && $battleQueue.status !== 'match_found'}
					<button onclick={handleCancelQueue} class="btn-action btn-battle" title="Cancel search">
						<span class="btn-action-face btn-battle-pulse">
							<Swords class="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 animate-spin" style="animation-duration: 2s;" strokeWidth={2} />
							Searching...
						</span>
					</button>
				{:else}
					<button onclick={handleBattleClick} class="btn-action btn-battle" title="Find an opponent">
						<span class={"btn-action-face" + (battleSearching > 0 ? ' btn-battle-pulse' : '')}>
							<Swords class="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} />
							Battle
						</span>
						{#if battleSearching > 0}
							<span class="absolute -top-2 -right-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold" style="background: var(--accent-red); color: var(--bg);">{battleSearching}</span>
						{/if}
					</button>
				{/if}
				<a href="/leaderboard" class="btn-action btn-gold cursor-pointer !rounded-full">
					<span class="btn-action-face !rounded-full h-10 w-10 sm:h-[46px] sm:w-[46px] !p-0 items-center justify-center">
						<svg viewBox="0 0 24 24" fill="#eab308" class="h-[18px] w-[18px] sm:h-5 sm:w-5"
						><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg
					>
					</span>
				</a>
				<SoundButton size="lg" />
			</div>
		</div>

		<!-- Generated level grid -->
		<div class="mx-auto mt-2 w-full max-w-3xl px-4">
			{#if mounted && gridLevels.length > 0}
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
					{#each gridLevels as level, i (level.seed)}
						<LevelTile {level} delay={i * 80} />
					{/each}
				</div>
			{:else}
				<!-- Skeleton grid while loading -->
				<div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
					{#each Array(12) as _}
						<div class="h-[76px] animate-pulse rounded-2xl" style="background: var(--surface);"></div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div
			class="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 pb-6 text-[11px] sm:text-xs"
			style="color: var(--text-tertiary);"
		>
			<span>Created by</span>
			<a
				href="https://www.linkedin.com/in/mohsenvand/"
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1 transition hover:opacity-80"
				style="color: var(--text-secondary);"
			>
				<Linkedin size={12} strokeWidth={2} />
				Neo Mohsenvand
			</a>
			<span class="opacity-50">·</span>
			<a
				href="https://github.com/NeoVand/MacMac"
				target="_blank"
				rel="noopener"
				class="inline-flex items-center gap-1 transition hover:opacity-80"
				style="color: var(--text-secondary);"
			>
				<Github size={12} strokeWidth={2} />
				GitHub
			</a>
		</div>
	</div>
</div>

<RankingsModal
	open={showRankings}
	onclose={() => showRankings = false}
	isAuthenticated={!!$session.data?.user}
	playerRating={data.playerRating}
	battleElo={data.battleElo}
	gamesPlayed={data.gamesPlayed}
	battlesPlayed={data.battlesPlayed}
/>
