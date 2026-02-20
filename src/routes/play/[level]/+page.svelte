<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { getLevel, levels } from '$lib/game/levels';
	import { getFullScore, getDifficultyColor, type ScoreResult } from '$lib/game/scoring';
	import { authClient } from '$lib/auth-client';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import ScorePanel from '$lib/components/ScorePanel.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { ZoomIn, ZoomOut, Fullscreen, Github, Eraser, ChevronLeft, ChevronRight, Trophy } from 'lucide-svelte';

	let { data } = $props();

	const levelId = $derived(Number(page.params.level));
	const level = $derived(getLevel(levelId));
	const topScore = $derived(data.topScore ?? 0);

	const session = authClient.useSession();
	let gameCanvas: ReturnType<typeof GameCanvas> | undefined = $state();

	let samples: number[] = $state([]);
	let totalClicks = $state(0);
	let eraserMode = $state(false);
	const emptyScore: ScoreResult = { mse: 1, clicks: 0, score: 0, matchPct: 0, matchScore: 0, timeBonus: 0, histogramData: [] };
	let scoreResult: ScoreResult = $state({ ...emptyScore });

	let startTime = $state(0);
	let elapsedMs = $state(0);
	let timerRunning = $state(false);
	let timerHandle = 0;

	let isSubmitting = $state(false);
	let showDialog = $state(false);

	// Replay
	let replayCanvas: HTMLCanvasElement | undefined = $state();
	let replayTimer: ReturnType<typeof setTimeout> | undefined;
	let replayIdx = $state(0);
	let replayKde: number[] = [];

	$effect(() => {
		void levelId;
		samples = [];
		totalClicks = 0;
		eraserMode = false;
		scoreResult = { ...emptyScore };
		showDialog = false;
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
	});

	let lastScoreRecalcSec = 0;

	function startTimer() {
		if (timerRunning) return;
		startTime = Date.now();
		timerRunning = true;
		lastScoreRecalcSec = 0;
		function tick() {
			if (!timerRunning) return;
			elapsedMs = Date.now() - startTime;
			const sec = Math.floor(elapsedMs / 1000);
			if (sec > lastScoreRecalcSec && samples.length > 0) {
				lastScoreRecalcSec = sec;
				recalcScore();
			}
			timerHandle = requestAnimationFrame(tick);
		}
		tick();
	}

	function stopTimer() {
		timerRunning = false;
		cancelAnimationFrame(timerHandle);
	}

	function recalcScore() {
		if (!level) return;
		scoreResult = samples.length > 0
			? { ...getFullScore(samples, level, elapsedMs), clicks: totalClicks }
			: { ...emptyScore };
	}

	function addSample(x: number) {
		if (!level) return;
		if (samples.length === 0) startTimer();
		samples = [...samples, x];
		totalClicks++;
		recalcScore();
	}

	function handleCanvasSample(x: number) {
		if (eraserMode) {
			if (samples.length === 0) return;
			let minDist = Infinity, minIdx = -1;
			for (let i = 0; i < samples.length; i++) {
				const d = Math.abs(samples[i] - x);
				if (d < minDist) { minDist = d; minIdx = i; }
			}
			if (minIdx >= 0) {
				samples = [...samples.slice(0, minIdx), ...samples.slice(minIdx + 1)];
				totalClicks++;
				recalcScore();
			}
			// Auto-disable eraser after one erase
			eraserMode = false;
		} else {
			addSample(x);
		}
	}

	function undoLast() {
		if (samples.length === 0 || !level) return;
		samples = samples.slice(0, -1);
		recalcScore();
	}

	function resetSamples() {
		samples = [];
		totalClicks = 0;
		eraserMode = false;
		scoreResult = { ...emptyScore };
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
	}

	function openSubmit() {
		if (samples.length < 3) return;
		stopTimer();
		showDialog = true;
		startReplay();
	}

	function closeDialog() {
		showDialog = false;
		if (replayTimer) clearTimeout(replayTimer);
	}

	async function signInWith(provider: 'github' | 'google') {
		await authClient.signIn.social({ provider, callbackURL: window.location.href });
	}

	async function submitScore() {
		if (!level || !$session.data) return;
		isSubmitting = true;
		try {
			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ levelId: level.id, samples, duration: elapsedMs, clicks: totalClicks })
			});
			const result = await res.json();
			if (result.success) {
				closeDialog();
			}
		} catch { /* silent */ }
		finally { isSubmitting = false; }
	}

	// Smooth replay with lerped KDE
	function startReplay() {
		if (!level) return;
		const [xMin, xMax] = level.xRange;
		const xs = linspace(xMin, xMax, 200);
		replayIdx = 0;
		replayKde = new Array(200).fill(0);

		function step() {
			if (!showDialog) return;
			replayIdx++;
			if (replayIdx > samples.length) {
				replayIdx = 0;
				replayKde = new Array(200).fill(0);
			}

			// Compute target KDE for current step
			const replaySamples = samples.slice(0, replayIdx);
			const targetKde = replaySamples.length > 0 ? computeKDE(replaySamples, xs) : new Array(200).fill(0);

			// Lerp toward target
			for (let i = 0; i < 200; i++) {
				replayKde[i] += (targetKde[i] - replayKde[i]) * 0.4;
			}
			replayKde = [...replayKde];
			drawReplay(xs);

			replayTimer = setTimeout(step, 180);
		}
		step();
	}

	function drawReplay(xs: number[]) {
		if (!replayCanvas || !level) return;
		const ctx = replayCanvas.getContext('2d');
		if (!ctx) return;

		const w = replayCanvas.clientWidth;
		const h = replayCanvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		replayCanvas.width = w * dpr;
		replayCanvas.height = h * dpr;
		ctx.scale(dpr, dpr);

		const s = getComputedStyle(document.documentElement);
		ctx.fillStyle = s.getPropertyValue('--canvas-bg').trim();
		ctx.fillRect(0, 0, w, h);

		const accentCyan = s.getPropertyValue('--accent-cyan').trim();
		const kdeStroke = s.getPropertyValue('--kde-stroke').trim();
		const kdeFill = s.getPropertyValue('--kde-fill-start').trim();

		const pad = 12;
		const pw = w - pad * 2, ph = h - pad * 2;
		const [xMin, xMax] = level.xRange;
		const pdfVals = xs.map((x) => level.pdf(x));
		const pdfMax = Math.max(...pdfVals);
		let yMax = pdfMax * 1.15;
		if (yMax <= 0) yMax = 1;

		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad + ph - (y / yMax) * ph;
		const baseY = toY(0);

		// PDF curve
		ctx.beginPath();
		ctx.strokeStyle = accentCyan;
		ctx.lineWidth = 1.5;
		for (let i = 0; i < xs.length; i++) {
			i === 0 ? ctx.moveTo(toX(xs[i]), toY(pdfVals[i])) : ctx.lineTo(toX(xs[i]), toY(pdfVals[i]));
		}
		ctx.stroke();

		// KDE curve (lerped)
		if (replayIdx > 0) {
			// Fill
			ctx.beginPath();
			for (let i = 0; i < xs.length; i++) {
				const sy = toY(Math.min(replayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(xs[i]), sy) : ctx.lineTo(toX(xs[i]), sy);
			}
			ctx.lineTo(toX(xs[xs.length - 1]), baseY);
			ctx.lineTo(toX(xs[0]), baseY);
			ctx.closePath();
			ctx.fillStyle = kdeFill;
			ctx.fill();

			// Stroke
			ctx.beginPath();
			ctx.strokeStyle = kdeStroke;
			ctx.lineWidth = 1.5;
			for (let i = 0; i < xs.length; i++) {
				const sy = toY(Math.min(replayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(xs[i]), sy) : ctx.lineTo(toX(xs[i]), sy);
			}
			ctx.stroke();

			// Sample dots
			const replaySamples = samples.slice(0, replayIdx);
			for (const sp of replaySamples) {
				ctx.fillStyle = kdeStroke;
				ctx.beginPath();
				ctx.arc(toX(sp), baseY, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	const prevLevel = $derived(levelId > 1 ? levelId - 1 : null);
	const nextLevel = $derived(levelId < levels.length ? levelId + 1 : null);

	// Rank: compare score to topScore
	const isNewBest = $derived(topScore > 0 && scoreResult.score > topScore);
</script>

<svelte:head>
	<title>{level ? level.name : 'Not Found'} — macmac</title>
</svelte:head>

{#if !level}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="text-center">
			<div class="mb-2" style="color: var(--text-tertiary);">Level not found</div>
			<a href="/" class="text-sm" style="color: var(--accent-cyan);">Home</a>
		</div>
	</div>
{:else}
	<!-- Desktop: constrain to centered max-width -->
	<div class="mx-auto flex h-dvh max-w-4xl flex-col overflow-hidden" style="background: var(--bg);">
		<!-- Row 1: utility bar -->
		<div class="flex shrink-0 items-center justify-between px-4 py-2 sm:px-6">
			<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
				<span class="text-base" style="color: var(--text-secondary);">mac</span><span class="text-base" style="color: var(--accent-cyan); opacity: 0.6;">mac</span>
			</a>

			<div class="flex items-center gap-1.5">
				{#if prevLevel}
					<a href="/play/{prevLevel}" class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Previous level">
						<ChevronLeft size={18} />
					</a>
				{/if}
				{#if nextLevel}
					<a href="/play/{nextLevel}" class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Next level">
						<ChevronRight size={18} />
					</a>
				{/if}
				<a href="/leaderboard" class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Leaderboard">
					<Trophy size={16} />
				</a>
				<ThemeToggle />
				<UserAvatar size="sm" />
			</div>
		</div>

		<!-- Row 2: level name -->
		<div class="flex shrink-0 items-center gap-2 px-4 pb-1.5 sm:px-6">
			<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {getDifficultyColor(level.difficulty)}"></span>
			<span class="text-sm font-semibold" style="color: var(--text-primary); opacity: 0.7;">{level.id}. {level.name}</span>
			{#if isNewBest}
				<span class="ml-auto text-xs font-bold text-yellow-500">New #1</span>
			{/if}
		</div>

		<!-- Score panel -->
		<div class="shrink-0 px-4 pb-1 sm:px-6">
			<ScorePanel {scoreResult} {topScore} {elapsedMs} />
		</div>

		<!-- Canvas -->
		<div class="relative min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas bind:this={gameCanvas} {level} {samples} onSampleAdd={handleCanvasSample} {eraserMode} />
			<div class="absolute right-4 top-3 flex flex-col gap-1 sm:right-6">
				<button onclick={() => gameCanvas?.zoomIn()} class="flex h-7 w-7 items-center justify-center rounded-md transition hover:opacity-70" style="background: var(--glass); color: var(--text-tertiary);" aria-label="Zoom in"><ZoomIn size={14} /></button>
				<button onclick={() => gameCanvas?.zoomOut()} class="flex h-7 w-7 items-center justify-center rounded-md transition hover:opacity-70" style="background: var(--glass); color: var(--text-tertiary);" aria-label="Zoom out"><ZoomOut size={14} /></button>
				<button onclick={() => gameCanvas?.resetZoom()} class="flex h-7 w-7 items-center justify-center rounded-md transition hover:opacity-70" style="background: var(--glass); color: var(--text-tertiary);" aria-label="Reset view"><Fullscreen size={14} /></button>
			</div>
		</div>

		<!-- Bottom controls -->
		<div class="shrink-0 px-4 py-2 sm:px-6">
			<div class="flex items-center justify-between">
				<div class="flex gap-2">
					<button onclick={undoLast} disabled={samples.length === 0} class="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-70 disabled:opacity-20" style="background: var(--surface); color: var(--text-secondary);">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
						Undo
					</button>
					<button
						onclick={() => { eraserMode = !eraserMode; }}
						disabled={samples.length === 0}
						class="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-70 disabled:opacity-20"
						style="background: {eraserMode ? 'color-mix(in srgb, #ef4444 15%, var(--surface))' : 'var(--surface)'}; color: {eraserMode ? '#ef4444' : 'var(--text-secondary)'}; border: {eraserMode ? '1px solid color-mix(in srgb, #ef4444 30%, transparent)' : 'none'};"
					>
						<Eraser size={16} />
						Erase
					</button>
					<button onclick={resetSamples} disabled={samples.length === 0} class="flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition hover:opacity-70 disabled:opacity-20" style="background: var(--surface); color: var(--text-secondary);">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
						Reset
					</button>
				</div>

				<button onclick={openSubmit} disabled={samples.length < 3} class="flex h-10 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition active:scale-95 disabled:opacity-20" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" /></svg>
					Submit
				</button>
			</div>
		</div>
	</div>

	<!-- Submit dialog -->
	{#if showDialog}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style="background: var(--overlay);"
			onclick={(e) => { if (e.target === e.currentTarget) closeDialog(); }}
			onkeydown={(e) => e.key === 'Escape' && closeDialog()}
		>
			<div class="mx-4 w-full max-w-sm rounded-2xl p-5 shadow-2xl" style="background: var(--bg); border: 1px solid var(--border);">
				<!-- Replay -->
				<canvas bind:this={replayCanvas} class="mb-4 h-28 w-full rounded-lg sm:h-36" style="background: var(--canvas-bg);"></canvas>

				<!-- Stats -->
				<div class="mb-4 flex justify-between text-center">
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Score</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--text-primary);">{scoreResult.score.toLocaleString()}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Accuracy</div>
						<div class="text-lg font-bold tabular-nums" style="color: #4ade80;">{scoreResult.matchPct}%</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Clicks</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-orange);">{totalClicks}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Time</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-purple);">
							{Math.floor(elapsedMs / 60000)}:{(Math.floor(elapsedMs / 1000) % 60).toString().padStart(2, '0')}
						</div>
					</div>
				</div>

				{#if isNewBest}
					<div class="mb-3 text-center text-sm font-bold text-yellow-500">New #1 on this level!</div>
				{/if}

				{#if !$session.data}
					<p class="mb-3 text-xs" style="color: var(--text-secondary);">Sign in to submit your score to the leaderboard.</p>
					<div class="flex flex-col gap-2">
						<button onclick={() => signInWith('github')} class="flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition hover:opacity-80" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">
							<Github size={16} /> Continue with GitHub
						</button>
						<button onclick={() => signInWith('google')} class="flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-medium transition hover:opacity-80" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">
							<svg viewBox="0 0 24 24" class="h-4 w-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
							Continue with Google
						</button>
					</div>
					<button onclick={closeDialog} class="mt-3 w-full rounded-lg py-2 text-sm font-medium transition hover:opacity-70" style="background: var(--surface); color: var(--text-tertiary);">Cancel</button>
				{:else}
					<div class="mb-4 flex items-center gap-3 rounded-lg px-3 py-2" style="background: var(--surface); border: 1px solid var(--border);">
						{#if $session.data.user.image}
							<img src={$session.data.user.image} alt="" class="h-7 w-7 rounded-full" />
						{/if}
						<div class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">{$session.data.user.name}</div>
					</div>
					<div class="flex gap-2">
						<button onclick={closeDialog} class="flex-1 rounded-lg py-2.5 text-sm font-medium transition hover:opacity-70" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">Cancel</button>
						<button onclick={submitScore} disabled={isSubmitting} class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-80 disabled:opacity-25" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">{isSubmitting ? 'Saving…' : 'Submit'}</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
