<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import type { Level } from '$lib/game/levels';
	import { parseGeneratedId, reconstructLevel, type GeneratedLevel } from '$lib/game/generator';
	import { getFullScore, computeTimeBonus, TIME_LIMIT_MS, type ScoreResult } from '$lib/game/scoring';
	import { difficultyColor } from '$lib/game/difficulty';
	import { computeWeightedScore, computeNewRating } from '$lib/game/rating';
	import { authClient } from '$lib/auth-client';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import ScorePanel from '$lib/components/ScorePanel.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { Github } from 'lucide-svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { computeSkillLevel, getSkillTier, getTierProgress } from '$lib/game/rating';

	let { data } = $props();

	const levelParam = $derived(page.params.level ?? '');

	// Resolve the level from generated ID (g-seed-diff)
	const resolvedLevel = $derived.by<Level | null>(() => {
		const parsed = parseGeneratedId(levelParam);
		if (parsed) {
			return reconstructLevel(parsed.seed, parsed.targetDifficulty);
		}
		return null;
	});

	const generatedLevel = $derived(resolvedLevel as GeneratedLevel | null);
	const level = $derived(resolvedLevel);

	const session = authClient.useSession();

	let samples: number[] = $state([]);
	let totalClicks = $state(0);
	const emptyScore: ScoreResult = { mse: 1, clicks: 0, score: 0, matchPct: 0, matchScore: 0, timeBonus: 0, histogramData: [] };
	let scoreResult: ScoreResult = $state({ ...emptyScore });

	let startTime = $state(0);
	let elapsedMs = $state(0);
	let timerRunning = $state(false);
	let timerHandle = 0;

	let isSubmitting = $state(false);
	let showDialog = $state(false);
	let submitted = $state(false);
	let submittedRank = $state<number | null>(null);
	let submittedSkillLevel = $state<number | null>(null);
	let submittedOldSkillLevel = $state<number | null>(null);
	let submittedTierName = $state<string | null>(null);
	let submittedTierColor = $state<string | null>(null);
	let submittedRankUp = $state(false);
	let pausedElapsed = $state(0);
	let expired = $state(false);

	// Countdown
	const timeLeftMs = $derived(Math.max(0, TIME_LIMIT_MS - elapsedMs));
	const timerDisplay = $derived.by(() => {
		const sec = Math.max(0, Math.ceil(timeLeftMs / 1000));
		return `${sec}s`;
	});
	const timerPct = $derived(timeLeftMs / TIME_LIMIT_MS);
	const timerColor = $derived.by(() => {
		if (timerPct > 0.5) return 'var(--accent-cyan)';
		if (timerPct > 0.2) return 'var(--accent-orange)';
		return 'var(--accent-red)';
	});
	const timerUrgent = $derived(timeLeftMs <= 10000);
	const timerCritical = $derived(timeLeftMs <= 5000);

	// Reset limit (generated levels only)
	const MAX_RESETS = 3;
	let resetCount = $state(0);
	const resetsLeft = $derived(MAX_RESETS - resetCount);
	const canReset = $derived(resetsLeft > 0);

	// Replay
	let replayCanvas: HTMLCanvasElement | undefined = $state();
	let replayTimer: ReturnType<typeof setTimeout> | undefined;
	let replayIdx = $state(0);
	let replayKde: number[] = [];

	$effect(() => {
		void levelParam;
		samples = [];
		totalClicks = 0;
		scoreResult = { ...emptyScore };
		showDialog = false;
		submitted = false;
		submittedRank = null;
		submittedSkillLevel = null;
		submittedOldSkillLevel = null;
		submittedTierName = null;
		submittedTierColor = null;
		submittedRankUp = false;
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
		resetCount = 0;
		expired = false;
	});

	// Restore game state after OAuth redirect
	onMount(() => {
		if (typeof sessionStorage === 'undefined') return;
		const saved = sessionStorage.getItem('macmac_game_state');
		if (!saved) return;
		sessionStorage.removeItem('macmac_game_state');
		try {
			const state = JSON.parse(saved);
			if (state.levelParam !== levelParam) return;
			samples = state.samples || [];
			totalClicks = state.totalClicks || samples.length;
			elapsedMs = state.elapsedMs || 0;
			resetCount = state.resetCount || 0;
			pausedElapsed = elapsedMs;
			if (elapsedMs >= TIME_LIMIT_MS) expired = true;
			if (samples.length > 0 && level) {
				recalcScore();
				showDialog = true;
				submitted = false;
				startReplay();
			}
		} catch { /* ignore bad data */ }
	});

	// Weighted score for generated levels
	const weightedScore = $derived.by(() => {
		if (!generatedLevel || scoreResult.score <= 0) return 0;
		return computeWeightedScore(scoreResult.score, generatedLevel.targetDifficulty);
	});

	// Skill level preview (authenticated users)
	const currentSkillLevel = $derived(
		data.playerRating !== null ? computeSkillLevel(data.playerRating) : null
	);
	const previewSkillLevel = $derived.by(() => {
		if (data.playerRating === null || !generatedLevel || weightedScore <= 0) return null;
		const newRating = computeNewRating(data.playerRating, weightedScore, data.playerGamesPlayed);
		return computeSkillLevel(newRating);
	});

	// Skill level preview for unauthenticated users (as if new player)
	const anonPreviewSkillLevel = $derived.by(() => {
		if (!generatedLevel || weightedScore <= 0) return null;
		const newRating = computeNewRating(0, weightedScore, 0);
		return computeSkillLevel(newRating);
	});

	function startTimer() {
		if (timerRunning) return;
		startTime = Date.now();
		timerRunning = true;
		function tick() {
			if (!timerRunning) return;
			elapsedMs = Date.now() - startTime;
			if (elapsedMs >= TIME_LIMIT_MS) {
				elapsedMs = TIME_LIMIT_MS;
				expired = true;
				stopTimer();
				recalcScore(false);
				openSubmit();
				return;
			}
			if (samples.length > 0) recalcScore(false);
			timerHandle = requestAnimationFrame(tick);
		}
		tick();
	}

	function stopTimer() {
		timerRunning = false;
		cancelAnimationFrame(timerHandle);
	}

	function recalcScore(updateShape: boolean = true) {
		if (!level) return;
		if (samples.length === 0) {
			scoreResult = { ...emptyScore };
			return;
		}

		if (updateShape) {
			scoreResult = { ...getFullScore(samples, level, elapsedMs), clicks: totalClicks };
			return;
		}

		const timeBonus = computeTimeBonus(elapsedMs);
		if (timeBonus === scoreResult.timeBonus && totalClicks === scoreResult.clicks) return;
		scoreResult = {
			...scoreResult,
			clicks: totalClicks,
			timeBonus,
			score: scoreResult.matchScore + timeBonus
		};
	}

	function addSample(x: number) {
		if (!level || expired) return;
		if (samples.length === 0) startTimer();
		samples = [...samples, x];
		totalClicks++;
		recalcScore();
	}

	function handleCanvasSample(x: number) {
		addSample(x);
	}

	function undoLast() {
		if (samples.length === 0 || !level) return;
		samples = samples.slice(0, -1);
		recalcScore();
	}

	function resetSamples() {
		samples = [];
		totalClicks = 0;
		scoreResult = { ...emptyScore };
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
		expired = false;
		resetCount++;
	}

	function playAgain() {
		showDialog = false;
		if (replayTimer) cancelAnimationFrame(replayTimer as unknown as number);
		// Navigate to a new curve with the same difficulty
		const newSeed = Date.now();
		const diff = generatedLevel?.targetDifficulty ?? 4.0;
		const diffEncoded = Math.round(diff * 10);
		goto(`/play/g-${newSeed.toString(36)}-${diffEncoded}`);
	}

	function regenerateLevel() {
		// Navigate to a new random generated level
		const newSeed = Date.now();
		const diff = generatedLevel?.targetDifficulty ?? 4.0;
		const diffEncoded = Math.round(diff * 10);
		goto(`/play/g-${newSeed.toString(36)}-${diffEncoded}`);
	}

	function openSubmit() {
		if (samples.length < 1) return;
		stopTimer();
		pausedElapsed = elapsedMs;
		showDialog = true;
		submitted = false;
		markCompleted();
		startReplay();
	}

	/** Mark this level as completed in sessionStorage so the home grid replaces it */
	function markCompleted() {
		if (typeof sessionStorage === 'undefined') return;
		const parsed = parseGeneratedId(levelParam);
		if (!parsed) return;
		const key = 'macmac_completed';
		const stored = sessionStorage.getItem(key);
		let seeds: number[] = [];
		try { seeds = stored ? JSON.parse(stored) : []; } catch { /* */ }
		if (!seeds.includes(parsed.seed)) {
			seeds.push(parsed.seed);
			sessionStorage.setItem(key, JSON.stringify(seeds));
		}
	}

	async function signInWith(provider: 'github' | 'google') {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem('macmac_game_state', JSON.stringify({
				levelParam,
				samples,
				totalClicks,
				elapsedMs,
				resetCount
			}));
		}
		await authClient.signIn.social({ provider, callbackURL: window.location.href });
	}

	async function submitScore() {
		if (!level || !$session.data) return;
		isSubmitting = true;
		try {
			const body = {
				levelId: levelParam,
				seed: generatedLevel!.seed,
				targetDifficulty: generatedLevel!.targetDifficulty,
				samples,
				duration: elapsedMs,
				clicks: totalClicks
			};

			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json();
			if (result.success) {
				submitted = true;
				submittedRank = typeof result.rank === 'number' ? result.rank : null;
				submittedSkillLevel = typeof result.skillLevel === 'number' ? result.skillLevel : null;
				submittedOldSkillLevel = typeof result.oldSkillLevel === 'number' ? result.oldSkillLevel : null;
				submittedTierName = result.tierName ?? null;
				submittedTierColor = result.tierColor ?? null;
				submittedRankUp = !!result.rankUp;
				markCompleted();
			}
		} catch { /* silent */ }
		finally { isSubmitting = false; }
	}

	// Smooth replay with continuous animation
	const REPLAY_START_DELAY_FRAMES = 12;
	const REPLAY_STEP_FRAMES = 18;
	const REPLAY_HOLD_FRAMES = 90;
	const REPLAY_FADE_OUT_FRAMES = 33;
	const REPLAY_FADE_LERP = 0.22;

	let replayStepTimer = 0;
	let replayXs: number[] = [];
	let replayPhase: 'adding' | 'holding' | 'fadingOut' = 'adding';
	let replayPauseTimer = 0;
	let replayFadeTimer = 0;
	let replayFadeFactor = 1;

	function startReplay() {
		if (!level) return;
		const [xMin, xMax] = level.xRange;
		replayXs = linspace(xMin, xMax, 200);
		replayIdx = 0;
		replayKde = new Array(200).fill(0);
		replayStepTimer = 0;
		replayPhase = 'adding';
		replayPauseTimer = 0;
		replayFadeTimer = 0;
		replayFadeFactor = 1;

		function frame() {
			if (!showDialog) return;

			if (replayPhase === 'adding') {
				const interval = replayIdx === 0 ? REPLAY_START_DELAY_FRAMES : REPLAY_STEP_FRAMES;
				replayStepTimer++;
				if (replayStepTimer >= interval) {
					replayStepTimer = 0;
					replayIdx++;
					if (replayIdx > samples.length) {
						replayPhase = 'holding';
						replayPauseTimer = 0;
					}
				}
			} else if (replayPhase === 'holding') {
				replayPauseTimer++;
				if (replayPauseTimer > REPLAY_HOLD_FRAMES) {
					replayPhase = 'fadingOut';
					replayFadeTimer = 0;
				}
			} else {
				replayFadeTimer++;
				const targetKde = new Array(200).fill(0);
				for (let i = 0; i < 200; i++) {
					replayKde[i] += (targetKde[i] - replayKde[i]) * REPLAY_FADE_LERP;
				}
				replayFadeFactor = Math.max(0, 1 - replayFadeTimer / REPLAY_FADE_OUT_FRAMES);
				if (replayFadeTimer >= REPLAY_FADE_OUT_FRAMES) {
					replayIdx = 0;
					replayStepTimer = 0;
					replayPhase = 'adding';
					replayFadeFactor = 1;
					replayKde = replayKde.map(() => 0);
				}
			}

			if (replayPhase !== 'fadingOut') {
				const replaySamples = samples.slice(0, Math.min(replayIdx, samples.length));
				const targetKde = replaySamples.length > 0 ? computeKDE(replaySamples, replayXs) : new Array(200).fill(0);
				for (let i = 0; i < 200; i++) {
					replayKde[i] += (targetKde[i] - replayKde[i]) * 0.12;
				}
			}

			drawReplay();
			replayTimer = requestAnimationFrame(frame) as unknown as ReturnType<typeof setTimeout>;
		}
		frame();
	}

	function drawReplay() {
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
		const canvasBg = s.getPropertyValue('--canvas-bg').trim();
		const axis = s.getPropertyValue('--canvas-axis').trim();
		const accentCyan = s.getPropertyValue('--accent-cyan').trim();
		const curveGlow = s.getPropertyValue('--curve-glow').trim();
		const curveFillStart = s.getPropertyValue('--curve-fill-start').trim();
		const curveFillEnd = s.getPropertyValue('--curve-fill-end').trim();
		const kdeStroke = s.getPropertyValue('--kde-stroke').trim();
		const kdeFillStart = s.getPropertyValue('--kde-fill-start').trim();
		const kdeFillEnd = s.getPropertyValue('--kde-fill-end').trim();
		const sampleGlow = s.getPropertyValue('--sample-glow').trim();
		const sampleDot = s.getPropertyValue('--sample-dot').trim();

		ctx.fillStyle = canvasBg;
		ctx.fillRect(0, 0, w, h);

		const pad = 12;
		const pw = w - pad * 2, ph = h - pad * 2;
		const [xMin, xMax] = level.xRange;
		const pdfVals = replayXs.map((x) => level.pdf(x));
		const pdfMax = pdfVals.length > 0 ? Math.max(...pdfVals) : 0;
		const kdeMax = replayKde.length > 0 ? Math.max(...replayKde) : 0;
		const yMax = Math.max(pdfMax, kdeMax) * 1.15 || 1;

		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad + ph - (y / yMax) * ph;
		const baseY = toY(0);

		// Axis
		ctx.strokeStyle = axis;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(pad, baseY);
		ctx.lineTo(pad + pw, baseY);
		ctx.stroke();

		// KDE curve (lerped)
		if (replayIdx > 0 && replayFadeFactor > 0.01) {
			ctx.globalAlpha = replayFadeFactor;
			const clampedKde = replayKde.map((v) => Math.min(v, yMax * 0.99));

			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(clampedKde[i]);
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.lineTo(toX(replayXs[replayXs.length - 1]), baseY);
			ctx.lineTo(toX(replayXs[0]), baseY);
			ctx.closePath();
			const kdeGradient = ctx.createLinearGradient(0, pad, 0, baseY);
			kdeGradient.addColorStop(0, kdeFillStart);
			kdeGradient.addColorStop(1, kdeFillEnd);
			ctx.fillStyle = kdeGradient;
			ctx.fill();

			ctx.beginPath();
			ctx.strokeStyle = kdeStroke;
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 3]);
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(clampedKde[i]);
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineCap = 'butt';
			ctx.lineJoin = 'miter';
			ctx.globalAlpha = 1;
		}

		if (replayIdx > 0 && replayFadeFactor > 0.01) {
			ctx.globalAlpha = replayFadeFactor;
		}
		const replaySamples = replayPhase === 'fadingOut' ? samples : samples.slice(0, replayIdx);
		for (const sp of replaySamples) {
			ctx.fillStyle = sampleGlow;
			ctx.beginPath();
			ctx.arc(toX(sp), baseY, 6, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = sampleDot;
			ctx.beginPath();
			ctx.arc(toX(sp), baseY, 3.5, 0, Math.PI * 2);
			ctx.fill();
		}
		if (replayFadeFactor < 1) ctx.globalAlpha = 1;

		// PDF curve — family of curves
		const pdfFamilyScales = linspace(0.08, 1, 28);
		const dimFactor = 0.55;

		for (let si = 0; si < pdfFamilyScales.length; si++) {
			const scale = pdfFamilyScales[si];
			const isMain = si === pdfFamilyScales.length - 1;
			const alpha = (isMain ? 1.0 : 0.03 + (si / (pdfFamilyScales.length - 1)) * 0.35) * dimFactor;
			const lineW = isMain ? 2 : 0.45 + (si / (pdfFamilyScales.length - 1)) * 0.3;

			if (isMain) {
				ctx.beginPath();
				for (let i = 0; i < replayXs.length; i++) {
					const sy = toY(pdfVals[i]);
					i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
				}
				ctx.lineTo(toX(replayXs[replayXs.length - 1]), baseY);
				ctx.lineTo(toX(replayXs[0]), baseY);
				ctx.closePath();
				const pdfGradient = ctx.createLinearGradient(0, pad, 0, baseY);
				pdfGradient.addColorStop(0, curveFillStart);
				pdfGradient.addColorStop(1, curveFillEnd);
				ctx.fillStyle = pdfGradient;
				ctx.fill();

				ctx.beginPath();
				for (let i = 0; i < replayXs.length; i++) {
					const sy = toY(pdfVals[i]);
					i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
				}
				ctx.strokeStyle = curveGlow;
				ctx.lineWidth = 8;
				ctx.stroke();
			}

			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(pdfVals[i] * scale);
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = accentCyan;
			ctx.lineWidth = lineW;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}
	}

	// Display info
	const levelName = $derived(level ? (generatedLevel?.name ?? 'Generated') : 'Not Found');
	const levelDiffColor = $derived(
		generatedLevel ? difficultyColor(generatedLevel.targetDifficulty) : '#888'
	);
</script>

<svelte:head>
	<title>{levelName} — macmac</title>
</svelte:head>

{#if !level}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="text-center">
			<div class="mb-2" style="color: var(--text-tertiary);">Level not found</div>
			<a href="/" class="text-sm" style="color: var(--accent-cyan);">Home</a>
		</div>
	</div>
{:else}
	<div class="flex h-dvh flex-col overflow-hidden" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader />

		<!-- Countdown timer -->
		{#if timerRunning || showDialog || expired}
			<div class="shrink-0 px-4 pt-1 sm:px-6">
				<div class="flex items-center gap-2">
					<div class="relative h-2.5 flex-1 overflow-hidden rounded-full" style="background: color-mix(in srgb, {timerColor} 12%, var(--surface));">
						<div class="absolute inset-y-0 left-0 rounded-full transition-all duration-100" style="width: {timerPct * 100}%; background: linear-gradient(90deg, color-mix(in srgb, {timerColor} 60%, var(--bg)), {timerColor}, color-mix(in srgb, {timerColor} 50%, white)); {timerUrgent ? `box-shadow: 0 0 10px ${timerColor};` : ''}"></div>
					</div>
					<span class="min-w-[2rem] text-right text-sm tabular-nums font-bold {timerCritical ? 'timer-critical' : ''}" style="color: {timerUrgent ? timerColor : 'var(--text-tertiary)'};">{timerDisplay}</span>
				</div>
			</div>
		{/if}

		<!-- Score panel -->
		<div class="shrink-0 px-4 pb-1 pt-1 sm:px-6">
			<ScorePanel {scoreResult} {elapsedMs} difficultyMultiplier={generatedLevel ? 0.55 + generatedLevel.targetDifficulty * 0.15 : 1} />
		</div>

		<!-- Canvas -->
		<div class="relative min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas {level} {samples} onSampleAdd={handleCanvasSample} />
		</div>

		<!-- Bottom controls -->
		<div class="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
			<div class="flex items-center justify-between">
				<div class="flex gap-2">
					<!-- Undo -->
					<button onclick={undoLast} disabled={samples.length === 0} class="btn-action" style="--btn-color: var(--accent-purple);">
						<span class="btn-action-face">
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
							Undo
						</span>
					</button>

					<!-- Reset / Regenerate -->
					{#if canReset}
						<button onclick={resetSamples} disabled={samples.length === 0} class="btn-action" style="--btn-color: var(--accent-orange);">
							<span class="btn-action-face">
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
								Reset&nbsp;({resetsLeft})
							</span>
						</button>
					{:else}
						<button onclick={regenerateLevel} class="btn-action" style="--btn-color: var(--accent-orange);">
							<span class="btn-action-face">
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
								Regenerate
							</span>
						</button>
					{/if}
				</div>

				<!-- Submit -->
				<button onclick={openSubmit} disabled={samples.length < 1} class="btn-action" style="--btn-color: var(--accent-cyan);">
					<span class="btn-action-face">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" /></svg>
						Submit
					</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Submit dialog (terminal — no dismiss) -->
	{#if showDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm" style="background: var(--overlay);">
			<div class="relative mx-4 w-full max-w-sm rounded-2xl p-5 shadow-2xl" style="background: var(--bg); border: 1px solid var(--border);">
				<!-- Replay -->
				<canvas bind:this={replayCanvas} class="mb-4 h-28 w-full rounded-lg sm:h-36" style="background: var(--canvas-bg);"></canvas>

				<!-- Stats -->
				<div class="mb-4 flex justify-between text-center">
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Score</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--text-primary);">{(weightedScore > 0 ? weightedScore : scoreResult.score).toLocaleString()}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Match</div>
						<div class="text-lg font-bold tabular-nums" style="color: #4ade80;">{scoreResult.matchPct}%</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Clicks</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-orange);">{totalClicks}</div>
					</div>
					<div>
						<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Time</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-cyan);">
							{(elapsedMs / 1000).toFixed(1)}s
						</div>
					</div>
				</div>

				{#if !$session.data}
					{#if anonPreviewSkillLevel !== null}
						{@const tier = getSkillTier(anonPreviewSkillLevel)}
						{@const progress = getTierProgress(anonPreviewSkillLevel)}
						<div class="mb-3 flex flex-col items-center gap-1">
							<div class="flex items-center gap-2">
								<RankBadge skillLevel={anonPreviewSkillLevel} size="lg" />
								<span class="text-lg font-bold tabular-nums" style="color: {tier.color};">
									{tier.name}
								</span>
							</div>
							<div class="w-full max-w-[200px]">
								<div class="flex items-center justify-between text-[9px]" style="color: var(--text-tertiary);">
									<span style="color: {tier.color};">{tier.name}</span>
									<span>{Math.round(progress * 100)}%</span>
								</div>
								<div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full" style="background: color-mix(in srgb, {tier.color} 15%, var(--surface));">
									<div class="h-full rounded-full" style="width: {progress * 100}%; background: {tier.color};"></div>
								</div>
							</div>
						</div>
					{/if}
					<p class="mb-3 text-xs text-center" style="color: var(--text-tertiary);">Sign in to claim your rank.</p>
					<div class="mb-3 flex flex-col gap-2">
						<button onclick={() => signInWith('github')} class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80" style="background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border);">
							<Github size={14} /> Continue with GitHub
						</button>
						<button onclick={() => signInWith('google')} class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80" style="background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border);">
							<svg viewBox="0 0 24 24" class="h-3.5 w-3.5"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
							Continue with Google
						</button>
					</div>
					<div class="flex gap-2">
						<a href="/" class="btn-action flex-1" style="--btn-color: var(--text-secondary);">
							<span class="btn-action-face w-full justify-center">Home</span>
						</a>
						<button onclick={playAgain} class="btn-action flex-1" style="--btn-color: var(--accent-cyan);">
							<span class="btn-action-face w-full justify-center">Play Again</span>
						</button>
					</div>
				{:else if submitted}
					<!-- Post-submit -->
					<div class="mb-3 text-center text-sm font-semibold" style="color: #4ade80;">Score submitted!</div>

					<!-- Skill level + rank badge + tier progress -->
					{#if submitted && submittedSkillLevel !== null}
						<div class="mb-4 flex flex-col items-center gap-1.5">
							{#if submittedRankUp && submittedTierName}
								<div class="rank-up-anim mb-1 text-center text-xs font-bold uppercase tracking-wider" style="color: {submittedTierColor};">
									Rank Up! — {submittedTierName}
								</div>
							{/if}
							<div class="flex items-center gap-2">
								<RankBadge skillLevel={submittedSkillLevel} size="lg" />
								<div class="flex flex-col">
									<span class="text-lg font-bold tabular-nums" style="color: {submittedTierColor};">
										{submittedSkillLevel.toLocaleString()}
									</span>
									{#if submittedOldSkillLevel !== null}
										{@const delta = submittedSkillLevel - submittedOldSkillLevel}
										<span class="text-[10px] font-semibold tabular-nums" style="color: {delta >= 0 ? 'var(--win-green)' : 'var(--loss-red)'};">
											{delta >= 0 ? '+' : ''}{delta}
										</span>
									{/if}
								</div>
							</div>
							<!-- Tier progress bar -->
							<div class="mt-1 w-full max-w-[200px]">
								<div class="flex items-center justify-between text-[9px]" style="color: var(--text-tertiary);">
									<span style="color: {getSkillTier(submittedSkillLevel).color};">{getSkillTier(submittedSkillLevel).name}</span>
									<span>{Math.round(getTierProgress(submittedSkillLevel) * 100)}%</span>
								</div>
								<div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full" style="background: color-mix(in srgb, {getSkillTier(submittedSkillLevel).color} 15%, var(--surface));">
									<div class="h-full rounded-full transition-all" style="width: {getTierProgress(submittedSkillLevel) * 100}%; background: {getSkillTier(submittedSkillLevel).color};"></div>
								</div>
							</div>
						</div>
					{/if}

					{#if submitted && submittedRank !== null}
						<div class="mb-3 text-center text-sm font-bold" style="color: var(--accent-cyan);">
							Leaderboard rank: #{submittedRank}
						</div>
					{/if}
					<div class="flex gap-2">
						<a href="/" class="btn-action flex-1" style="--btn-color: var(--text-secondary);">
							<span class="btn-action-face w-full justify-center">Home</span>
						</a>
						<button onclick={playAgain} class="btn-action flex-1" style="--btn-color: var(--accent-cyan);">
							<span class="btn-action-face w-full justify-center">Play Again</span>
						</button>
					</div>
				{:else}
					<!-- Pre-submit: confirm -->
					<!-- Skill level preview -->
					{#if previewSkillLevel !== null && currentSkillLevel !== null}
						{@const newTier = getSkillTier(previewSkillLevel)}
						{@const progress = getTierProgress(previewSkillLevel)}
						{@const delta = previewSkillLevel - currentSkillLevel}
						<div class="mb-3 flex flex-col items-center gap-1">
							<div class="flex items-center gap-2">
								<RankBadge skillLevel={previewSkillLevel} size="lg" />
								<div class="flex flex-col">
									<span class="text-lg font-bold tabular-nums" style="color: {newTier.color};">
										{previewSkillLevel.toLocaleString()}
									</span>
									<span class="text-[10px] font-semibold tabular-nums" style="color: {delta >= 0 ? 'var(--win-green)' : 'var(--loss-red)'};">
										{delta >= 0 ? '+' : ''}{delta}
									</span>
								</div>
							</div>
							<div class="w-full max-w-[200px]">
								<div class="flex items-center justify-between text-[9px]" style="color: var(--text-tertiary);">
									<span style="color: {newTier.color};">{newTier.name}</span>
									<span>{Math.round(progress * 100)}%</span>
								</div>
								<div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full" style="background: color-mix(in srgb, {newTier.color} 15%, var(--surface));">
									<div class="h-full rounded-full transition-all" style="width: {progress * 100}%; background: {newTier.color};"></div>
								</div>
							</div>
						</div>
					{/if}

					<div class="mb-4 flex items-center gap-3 rounded-lg px-3 py-2" style="background: var(--surface); border: 1px solid var(--border);">
						{#if $session.data.user.image}
							<img src={$session.data.user.image} alt="" class="h-7 w-7 rounded-full" />
						{/if}
						<div class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">{$session.data.user.name}</div>
					</div>
					<div class="flex gap-2">
						<button onclick={submitScore} disabled={isSubmitting} class="btn-action flex-1" style="--btn-color: var(--accent-cyan);">
							<span class="btn-action-face w-full justify-center">{isSubmitting ? 'Saving…' : 'Submit'}</span>
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
