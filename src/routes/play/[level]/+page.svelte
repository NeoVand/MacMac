<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getLevel, levels, type Level } from '$lib/game/levels';
	import { parseGeneratedId, reconstructLevel, type GeneratedLevel } from '$lib/game/generator';
	import { getFullScore, getDifficultyColor, computeTimeBonus, type ScoreResult } from '$lib/game/scoring';
	import { difficultyColor } from '$lib/game/difficulty';
	import { computeWeightedScore } from '$lib/game/rating';
	import { authClient } from '$lib/auth-client';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import ScorePanel from '$lib/components/ScorePanel.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { Github } from 'lucide-svelte';

	let { data } = $props();
	type TopRank = 1 | 2 | 3 | null;

	const levelParam = $derived(page.params.level ?? '');

	// Resolve the level: either legacy (numeric) or generated (g-seed-diff)
	const resolvedLevel = $derived.by<Level | null>(() => {
		const parsed = parseGeneratedId(levelParam);
		if (parsed) {
			return reconstructLevel(parsed.seed, parsed.targetDifficulty);
		}
		const id = Number(levelParam);
		return (id > 0 ? getLevel(id) : null) ?? null;
	});

	const isGenerated = $derived(levelParam.startsWith('g-'));
	const generatedLevel = $derived(isGenerated ? (resolvedLevel as GeneratedLevel | null) : null);
	const level = $derived(resolvedLevel);

	const topScores = $derived((data.topScores as number[] | undefined) ?? []);
	const topScore = $derived(data.topScore ?? 0);

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
	let rankPreview = $state<number | null>(null);
	let rankPreviewLoading = $state(false);
	let pausedElapsed = $state(0);

	// Reset limit (generated levels only)
	const MAX_RESETS = 3;
	let resetCount = $state(0);
	const resetsLeft = $derived(MAX_RESETS - resetCount);
	const canReset = $derived(!isGenerated || resetsLeft > 0);

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
		rankPreview = null;
		rankPreviewLoading = false;
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
		resetCount = 0;
	});

	// Fetch rank preview when modal opens (legacy levels only)
	$effect(() => {
		if (!showDialog || scoreResult.score <= 0 || isGenerated) {
			rankPreview = null;
			rankPreviewLoading = false;
			return;
		}
		const levelId = Number(levelParam);
		rankPreview = null;
		rankPreviewLoading = true;
		let cancelled = false;
		fetch(`/api/scores/rank?levelId=${levelId}&score=${Math.round(scoreResult.score)}`)
			.then((r) => r.json())
			.then((data) => {
				if (!cancelled) {
					rankPreview = typeof data.rank === 'number' ? data.rank : null;
					rankPreviewLoading = false;
				}
			})
			.catch(() => {
				if (!cancelled) rankPreviewLoading = false;
			});
		return () => { cancelled = true; };
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

	function startTimer() {
		if (timerRunning) return;
		startTime = Date.now();
		timerRunning = true;
		function tick() {
			if (!timerRunning) return;
			elapsedMs = Date.now() - startTime;
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
		if (!level) return;
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
		resetCount++;
	}

	function regenerateLevel() {
		// Navigate to a new random generated level
		const newSeed = Date.now();
		const diff = generatedLevel?.targetDifficulty ?? 4.0;
		const diffEncoded = Math.round(diff * 10);
		goto(`/play/g-${newSeed.toString(36)}-${diffEncoded}`);
	}

	function resumeTimer() {
		if (!timerRunning && samples.length > 0) {
			startTime = Date.now() - pausedElapsed;
			timerRunning = true;
			function tick() {
				if (!timerRunning) return;
				elapsedMs = Date.now() - startTime;
				recalcScore(false);
				timerHandle = requestAnimationFrame(tick);
			}
			tick();
		}
	}

	function openSubmit() {
		if (samples.length < 1) return;
		stopTimer();
		pausedElapsed = elapsedMs;
		showDialog = true;
		submitted = false;
		startReplay();
	}

	function closeDialog() {
		showDialog = false;
		if (replayTimer) cancelAnimationFrame(replayTimer as unknown as number);
		resumeTimer();
	}

	/** Mark this level as completed in sessionStorage so the home grid replaces it */
	function markCompleted() {
		if (!isGenerated || typeof sessionStorage === 'undefined') return;
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
			const body = isGenerated
				? { levelId: levelParam, seed: generatedLevel!.seed, targetDifficulty: generatedLevel!.targetDifficulty, samples, duration: elapsedMs, clicks: totalClicks }
				: { levelId: Number(levelParam), samples, duration: elapsedMs, clicks: totalClicks };

			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json();
			if (result.success) {
				submitted = true;
				submittedRank = typeof result.rank === 'number' ? result.rank : null;
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

	// Navigation: only for legacy levels
	const legacyId = $derived(isGenerated ? null : Number(levelParam));
	const prevLevel = $derived(legacyId && legacyId > 1 ? legacyId - 1 : null);
	const nextLevel = $derived(legacyId && legacyId < levels.length ? legacyId + 1 : null);

	// Rank: compare score to topScore (legacy only)
	const isNewBest = $derived(!isGenerated && topScore > 0 && scoreResult.score > topScore);
	const scoreRank = $derived.by<TopRank>(() => {
		if (isGenerated) return null;
		const score = scoreResult.score;
		if (score <= 0) return null;

		let betterScores = 0;
		for (const s of topScores) {
			if (s > score) betterScores++;
		}

		const rank = betterScores + 1;
		return rank <= 3 ? rank as Exclude<TopRank, null> : null;
	});

	// Display info
	const levelName = $derived(level ? (isGenerated ? generatedLevel?.name ?? 'Generated' : `${legacyId}. ${level.name}`) : 'Not Found');
	const levelDiffColor = $derived(
		isGenerated && generatedLevel
			? difficultyColor(generatedLevel.targetDifficulty)
			: level ? getDifficultyColor(level.difficulty) : '#888'
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
		<AppHeader showNav={!isGenerated} prevHref={prevLevel ? `/play/${prevLevel}` : null} nextHref={nextLevel ? `/play/${nextLevel}` : null} />

		<!-- Level name + difficulty -->
		<div class="flex shrink-0 items-center gap-2 px-4 pb-1.5 sm:px-6">
			<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {levelDiffColor}"></span>
			<span class="text-sm font-semibold" style="color: var(--text-primary); opacity: 0.7;">{levelName}</span>
			{#if isGenerated && generatedLevel}
				<span class="text-[11px] font-semibold tabular-nums" style="color: {levelDiffColor};">
					{generatedLevel.targetDifficulty.toFixed(1)}
				</span>
			{/if}
			{#if isNewBest}
				<span class="ml-auto text-xs font-bold text-yellow-500">New #1</span>
			{/if}
		</div>

		<!-- Score panel -->
		<div class="shrink-0 px-4 pb-1 sm:px-6">
			<ScorePanel {scoreResult} {scoreRank} {elapsedMs} />
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
					<button onclick={undoLast} disabled={samples.length === 0} class="flex h-11 items-center gap-2 rounded-2xl px-4 text-[13px] font-medium transition-all hover:scale-[1.03] hover:shadow-md active:scale-95 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:shadow-none" style="background: color-mix(in srgb, var(--accent-purple) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-purple) 18%, transparent); color: color-mix(in srgb, var(--accent-purple) 70%, var(--text-primary));">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
						Undo
					</button>

					<!-- Reset / Regenerate -->
					{#if canReset}
						<button onclick={resetSamples} disabled={samples.length === 0} class="flex h-11 items-center gap-2 rounded-2xl px-4 text-[13px] font-medium transition-all hover:scale-[1.03] hover:shadow-md active:scale-95 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:shadow-none" style="background: color-mix(in srgb, var(--accent-orange) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-orange) 18%, transparent); color: color-mix(in srgb, var(--accent-orange) 65%, var(--text-primary));">
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
							Reset{#if isGenerated}&nbsp;({resetsLeft}){/if}
						</button>
					{:else}
						<button onclick={regenerateLevel} class="flex h-11 items-center gap-2 rounded-2xl px-4 text-[13px] font-medium transition-all hover:scale-[1.03] hover:shadow-md active:scale-95" style="background: color-mix(in srgb, var(--accent-orange) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-orange) 18%, transparent); color: color-mix(in srgb, var(--accent-orange) 65%, var(--text-primary));">
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
							Regenerate
						</button>
					{/if}
				</div>

				<!-- Submit -->
				<button onclick={openSubmit} disabled={samples.length < 1} class="flex h-11 items-center gap-2 rounded-2xl px-6 text-[13px] font-bold transition-all hover:scale-[1.04] hover:shadow-lg active:scale-95 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:shadow-none" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 30%, transparent); color: var(--accent-cyan);">
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
					{#if isGenerated && weightedScore > 0}
						<div>
							<div class="text-[9px] uppercase tracking-wider" style="color: var(--text-tertiary);">Weighted</div>
							<div class="text-lg font-bold tabular-nums" style="color: {levelDiffColor};">{weightedScore.toLocaleString()}</div>
						</div>
					{/if}
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
					{#if !isGenerated && rankPreviewLoading}
						<div class="mb-3 flex justify-center">
							<div class="h-4 w-32 animate-pulse rounded" style="background: color-mix(in srgb, var(--accent-cyan) 25%, var(--surface));"></div>
						</div>
					{:else if !isGenerated && rankPreview !== null}
						<div class="mb-3 text-center text-sm font-bold" style="color: var(--accent-cyan);">
							Your rank on this level: #{rankPreview}
						</div>
					{/if}
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
				{:else if submitted}
					<!-- Post-submit: success -->
					<div class="mb-3 text-center text-sm font-semibold" style="color: #4ade80;">Score submitted!</div>
					{#if submittedRank !== null}
						<div class="mb-3 text-center text-sm font-bold" style="color: var(--accent-cyan);">
							Leaderboard rank: #{submittedRank}
						</div>
					{/if}
					<div class="flex gap-2">
						{#if isGenerated}
							<a href="/" class="flex flex-1 items-center justify-center rounded-lg py-2.5 text-sm font-medium transition hover:opacity-70" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">Home</a>
						{:else}
							<button onclick={closeDialog} class="flex-1 rounded-lg py-2.5 text-sm font-medium transition hover:opacity-70" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">Keep Playing</button>
						{/if}
						<a href="/leaderboard" class="flex flex-1 items-center justify-center rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-80" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
							Leaderboard
						</a>
					</div>
				{:else}
					<!-- Pre-submit: confirm -->
					{#if !isGenerated && rankPreviewLoading}
						<div class="mb-3 flex justify-center">
							<div class="h-4 w-32 animate-pulse rounded" style="background: color-mix(in srgb, var(--accent-cyan) 25%, var(--surface));"></div>
						</div>
					{:else if !isGenerated && rankPreview !== null}
						<div class="mb-3 text-center text-sm font-bold" style="color: var(--accent-cyan);">
							Your rank on this level: #{rankPreview}
						</div>
					{/if}
					<div class="mb-4 flex items-center gap-3 rounded-lg px-3 py-2" style="background: var(--surface); border: 1px solid var(--border);">
						{#if $session.data.user.image}
							<img src={$session.data.user.image} alt="" class="h-7 w-7 rounded-full" />
						{/if}
						<div class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">{$session.data.user.name}</div>
					</div>
					<div class="flex gap-2">
						<button onclick={closeDialog} class="flex-1 rounded-lg py-2.5 text-sm font-medium transition hover:opacity-80" style="border: 1px solid var(--border-hover); color: var(--text-primary); opacity: 0.6;">Cancel</button>
						<button onclick={submitScore} disabled={isSubmitting} class="flex-1 rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-80 disabled:opacity-25" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">{isSubmitting ? 'Saving…' : 'Submit'}</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}
