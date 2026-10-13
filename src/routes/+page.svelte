<script lang="ts">
	import { onMount } from 'svelte';
	import { goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { gaussian, linspace } from '$lib/game/math';
	import { prefersReducedMotion } from 'svelte/motion';
	import { generateGrid, generateReplacement, gridConfigForRating } from '$lib/game/grid';
	import type { GeneratedLevel } from '$lib/game/generator';
	import { fetchBattleQueueCount } from '$lib/battle/client';
	import { battleQueue, startQueue, cancelQueue } from '$lib/stores/battle-queue';
	import { authClient } from '$lib/auth-client';
	import LevelTile from '$lib/components/LevelTile.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { computeSkillLevel } from '$lib/game/rating';
	import { Play, Pause, Sword, Swords } from 'lucide-svelte';
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
		return () => {
			active = false;
		};
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
	onMount(() => {
		let active = true;
		let wasInQueue = false;
		let refreshTimer: ReturnType<typeof setTimeout> | undefined;
		const unsubscribe = battleQueue.subscribe((queue) => {
			const inQueue = queue.status !== 'idle' && queue.status !== 'match_found';
			if (wasInQueue && !inQueue) {
				battleSearching = Math.max(0, battleSearching - 1);
				clearTimeout(refreshTimer);
				refreshTimer = setTimeout(async () => {
					const count = await fetchBattleQueueCount();
					if (active) battleSearching = count;
				}, 1500);
			}
			wasInQueue = inQueue;
		});
		return () => {
			active = false;
			clearTimeout(refreshTimer);
			unsubscribe();
		};
	});

	// --- Grid state ---
	const COMPLETED_KEY = 'macmac_completed';
	const skeletonIds = Array.from({ length: 12 }, (_, slot) => `skeleton-${slot}`);

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
		goto(resolve('/play/[level]', { level: String(pick.id) }));
	}

	onMount(() => {
		gridLevels = buildGrid();
		mounted = true;

		// Auto-start battle queue if navigated with ?battle
		if (page.url.searchParams.has('battle')) {
			replaceState(resolve('/'), {});
			handleBattleClick();
		}
	});

	// The original living contour waves, paced by elapsed time rather than frame count.
	let heroCanvas: HTMLCanvasElement | undefined;
	let animationPaused = $state(false);
	let pageHidden = $state(false);
	const wavePaused = $derived(animationPaused || pageHidden || prefersReducedMotion.current);
	const queued = $derived($battleQueue.status !== 'idle' && $battleQueue.status !== 'match_found');
	let animFrame = 0;
	let lastWaveTime = 0;
	let wavePhase = 3;
	let heroColors = {
		accentCyan: '#00d4ff',
		accentPurple: '#c084fc',
		curveGlow: 'rgba(0,200,255,0.12)',
		curveFillStart: 'rgba(0,200,255,0.07)',
		curveFillEnd: 'rgba(0,200,255,0)'
	};

	function refreshHeroColors() {
		const style = getComputedStyle(document.documentElement);
		const value = (name: string) => style.getPropertyValue(name).trim();
		heroColors = {
			accentCyan: value('--accent-cyan'),
			accentPurple: value('--accent-purple'),
			curveGlow: value('--curve-glow'),
			curveFillStart: value('--curve-fill-start'),
			curveFillEnd: value('--curve-fill-end')
		};
		paintHero();
	}

	function paintHero() {
		if (heroCanvas) drawHero(wavePhase, heroCanvas.clientWidth < 640);
	}

	function animateHero(now: number) {
		animFrame = 0;
		if (!heroCanvas || wavePaused) {
			lastWaveTime = 0;
			return;
		}
		if (lastWaveTime > 0) wavePhase += ((now - lastWaveTime) / 1000) * 0.9;
		lastWaveTime = now;
		paintHero();
		animFrame = requestAnimationFrame(animateHero);
	}

	function attachHeroCanvas(node: HTMLCanvasElement) {
		heroCanvas = node;
		refreshHeroColors();
		const themeObserver = new MutationObserver(refreshHeroColors);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		const resizeObserver = new ResizeObserver(paintHero);
		resizeObserver.observe(node);
		return () => {
			cancelAnimationFrame(animFrame);
			animFrame = 0;
			lastWaveTime = 0;
			heroCanvas = undefined;
			themeObserver.disconnect();
			resizeObserver.disconnect();
		};
	}

	function syncHeroAnimation(paused: boolean) {
		return () => {
			lastWaveTime = 0;
			if (paused) {
				cancelAnimationFrame(animFrame);
				animFrame = 0;
			} else if (heroCanvas && !animFrame) animFrame = requestAnimationFrame(animateHero);
			paintHero();
		};
	}

	function drawHero(t: number, isMobile = false) {
		if (!heroCanvas) return;
		const ctx = heroCanvas.getContext('2d');
		if (!ctx) return;

		const w = heroCanvas.clientWidth;
		const h = heroCanvas.clientHeight;
		if (w <= 0 || h <= 0) return;
		const dpr = isMobile ? Math.min(window.devicePixelRatio || 1, 2) : window.devicePixelRatio || 1;
		const pixelWidth = Math.round(w * dpr);
		const pixelHeight = Math.round(h * dpr);
		if (heroCanvas.width !== pixelWidth || heroCanvas.height !== pixelHeight) {
			heroCanvas.width = pixelWidth;
			heroCanvas.height = pixelHeight;
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
			(0.18 * gaussian(x, m1, s1) +
				0.22 * gaussian(x, m2, s2) +
				0.25 * gaussian(x, m3, s3) +
				0.2 * gaussian(x, m4, s4) +
				0.15 * gaussian(x, m5, s5));

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
			const alpha = si === scales.length - 1 ? 1.0 : 0.12 + (si / (scales.length - 1)) * 0.5;
			const lineW = si === scales.length - 1 ? 2.5 : 0.8 + (si / (scales.length - 1)) * 0.6;
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
		content="A 30-second game of sampling and visual intuition. Match the target curve solo or in a live duel."
	/>
	<meta property="og:title" content="macmac — The Sampling Game" />
	<meta
		property="og:description"
		content="A 30-second game of sampling and visual intuition. Match the target curve solo or in a live duel."
	/>
	<meta property="og:url" content="https://macmac-gilt.vercel.app" />
</svelte:head>

<svelte:document onvisibilitychange={() => (pageHidden = document.hidden)} />

<div class="title-screen">
	<AppHeader />
	<main class="home-main">
		<section class="wave-hero" aria-labelledby="game-title">
			<canvas
				class="contour-waves"
				{@attach attachHeroCanvas}
				{@attach syncHeroAnimation(wavePaused)}
				aria-hidden="true"
			></canvas>
			<div class="hero-wordmark">
				<h1 id="game-title">
					<span class="wordmark-first">Mac</span><span class="wordmark-second">Mac</span>
				</h1>
				<p>The sampling game</p>
			</div>
			{#if !prefersReducedMotion.current}<button
					type="button"
					class="wave-control"
					onclick={() => (animationPaused = !animationPaused)}
					aria-label={animationPaused
						? 'Resume background animation'
						: 'Pause background animation'}
					aria-pressed={animationPaused}
					>{#if animationPaused}<Play
							size={14}
							fill="currentColor"
							strokeWidth={1.5}
						/>{:else}<Pause size={14} />{/if}</button
				>{/if}
		</section>
		<p class="game-instruction">Match the curve. 30 seconds. Make every sample count.</p>
		<div class="home-actions">
			<button type="button" class="game-button solo-button" onclick={playSolo} disabled={!mounted}
				><Sword size={16} strokeWidth={2} aria-hidden="true" />Solo</button
			>
			{#if queued}<button
					type="button"
					class="game-button battle-button"
					onclick={handleCancelQueue}
					><Swords class="queue-spinner" size={16} strokeWidth={2} aria-hidden="true" /><span
						>Searching…</span
					></button
				>{:else}<button type="button" class="game-button battle-button" onclick={handleBattleClick}
					><Swords
						size={16}
						strokeWidth={2}
						aria-hidden="true"
					/>Battle{#if battleSearching > 0}<span class="queue-count">{battleSearching}</span
						>{/if}</button
				>{/if}
		</div>
		{#if (data.gamesPlayed > 0 && data.playerRating !== null) || (data.battlesPlayed > 0 && data.battleElo !== null)}
			<button
				type="button"
				class="player-ranks"
				onclick={() => (showRankings = true)}
				aria-label="View your rankings"
			>
				{#if data.gamesPlayed > 0 && data.playerRating !== null}{@const skill = computeSkillLevel(
						data.playerRating
					)}<span><RankBadge mode="solo" value={skill} size="sm" />{skill.toLocaleString()}</span
					>{/if}
				{#if data.battlesPlayed > 0 && data.battleElo !== null}<span
						><RankBadge mode="battle" value={data.battleElo} size="sm" />{data.battleElo}</span
					>{/if}
			</button>
		{:else if !$session.data?.user}<button
				type="button"
				class="sign-in-rank"
				onclick={() => (showRankings = true)}>Sign in to get ranked</button
			>{/if}
		<div class="level-grid" aria-label="Choose a curve">
			{#if mounted && gridLevels.length > 0}{#each gridLevels as level (level.seed)}<LevelTile
						{level}
					/>{/each}{:else}{#each skeletonIds as skeletonId (skeletonId)}<div
						class="level-skeleton"
						aria-hidden="true"
					></div>{/each}{/if}
		</div>
		<footer class="home-footer">
			<span
				>Created by <a href="https://www.linkedin.com/in/mohsenvand/" target="_blank" rel="noopener"
					>Neo Mohsenvand</a
				></span
			><a href="https://github.com/NeoVand/MacMac" target="_blank" rel="noopener">GitHub</a>
		</footer>
	</main>
</div>

<RankingsModal
	open={showRankings}
	onclose={() => (showRankings = false)}
	isAuthenticated={!!$session.data?.user}
	playerRating={data.playerRating}
	battleElo={data.battleElo}
	gamesPlayed={data.gamesPlayed}
	battlesPlayed={data.battlesPlayed}
/>

<style>
	.title-screen {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
		background: var(--bg);
	}
	.home-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		padding: 18px 0 28px;
	}
	.wave-hero {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: end;
		width: 100%;
		height: 220px;
		padding-bottom: 18px;
	}
	.contour-waves {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		opacity: 0.62;
		pointer-events: none;
	}
	.hero-wordmark {
		position: relative;
		z-index: 1;
		padding: 0 16px;
		text-align: center;
	}
	.hero-wordmark h1 {
		margin: 0;
		font-family: 'Believe Stronger', sans-serif;
		font-size: 128px;
		font-weight: 400;
		letter-spacing: -0.025em;
		line-height: 1;
	}
	.wordmark-first {
		color: var(--text-primary);
	}
	.wordmark-second {
		background: linear-gradient(90deg, var(--accent-cyan), #c084fc);
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
	}
	.hero-wordmark p {
		margin: 11px 0 0;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.24em;
		text-transform: uppercase;
	}
	.wave-control {
		position: absolute;
		right: max(16px, calc((100% - 768px) / 2));
		bottom: 17px;
		z-index: 2;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.wave-control:hover {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--surface) 55%, transparent);
	}
	.game-instruction {
		margin: 12px 16px 0;
		color: var(--text-secondary);
		font-size: 13px;
		line-height: 1.6;
		text-align: center;
	}
	.home-actions {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 22px 16px 0;
	}
	.game-button {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-width: 128px;
		height: 48px;
		padding: 0 23px;
		border: 0;
		border-radius: 12px;
		font-family: var(--font-body);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 140ms ease,
			transform 100ms ease;
	}
	.game-button:active {
		transform: translateY(1px);
	}
	.game-button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	.solo-button {
		background: color-mix(in srgb, var(--accent-cyan) 15%, var(--surface));
		color: var(--accent-cyan);
	}
	.solo-button:hover {
		background: color-mix(in srgb, var(--accent-cyan) 23%, var(--surface));
	}
	.battle-button {
		background: color-mix(in srgb, var(--accent-red) 15%, var(--surface));
		color: var(--accent-red);
	}
	.battle-button:hover {
		background: color-mix(in srgb, var(--accent-red) 23%, var(--surface));
	}
	.queue-count {
		position: absolute;
		top: -6px;
		right: -6px;
		display: grid;
		place-items: center;
		min-width: 19px;
		height: 19px;
		padding: 0 4px;
		border-radius: 50%;
		background: var(--accent-red);
		color: var(--on-accent);
		font-size: 10px;
	}
	:global(.queue-spinner) {
		animation: queue-search 1.4s linear infinite;
	}
	@keyframes queue-search {
		to {
			transform: rotate(360deg);
		}
	}
	.player-ranks {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 20px;
		min-height: 32px;
		margin-top: 13px;
		padding: 0 12px;
		border: 0;
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
	}
	.player-ranks span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.sign-in-rank {
		min-height: 32px;
		margin-top: 13px;
		padding: 0 10px;
		border: 0;
		background: transparent;
		color: var(--text-secondary);
		font-size: 11px;
		cursor: pointer;
	}
	.sign-in-rank:hover {
		color: var(--text-primary);
	}
	.level-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 8px;
		width: min(768px, calc(100% - 32px));
		margin-top: 26px;
	}
	.level-skeleton {
		height: 82px;
		border-radius: 12px;
		background: var(--surface);
	}
	.home-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin-top: 28px;
		padding-inline: 16px;
		color: var(--text-secondary);
		font-size: 11px;
	}
	.home-footer a:hover {
		color: var(--text-primary);
	}
	@media (max-width: 640px) {
		.home-main {
			justify-content: start;
			padding-top: 8px;
			padding-bottom: 24px;
		}
		.wave-hero {
			height: 190px;
			padding-bottom: 17px;
		}
		.hero-wordmark h1 {
			font-size: clamp(76px, 24vw, 96px);
		}
		.hero-wordmark p {
			margin-top: 12px;
			font-size: 10px;
			letter-spacing: 0.2em;
		}
		.contour-waves {
			opacity: 0.55;
		}
		.game-instruction {
			max-width: 32ch;
			margin-top: 13px;
			font-size: 12px;
		}
		.home-actions {
			padding-top: 18px;
			gap: 10px;
		}
		.game-button {
			min-width: 125px;
			height: 46px;
			padding-inline: 17px;
			font-size: 14px;
		}
		.level-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			margin-top: 23px;
		}
		.wave-control {
			right: 12px;
			bottom: 12px;
		}
		.home-footer {
			margin-top: 23px;
			font-size: 10px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.game-button {
			transition: none;
		}
		:global(.queue-spinner) {
			animation: none;
		}
	}
</style>
