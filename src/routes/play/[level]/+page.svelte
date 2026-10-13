<script lang="ts">
	import { onMount } from 'svelte';
	import { playSample, playUndo, playReset, playCountdown, playSuccess } from '$lib/audio';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import type { Level } from '$lib/game/levels';
	import { parseGeneratedId, reconstructLevel, type GeneratedLevel } from '$lib/game/generator';
	import {
		getFullScore,
		computeTimeBonus,
		TIME_LIMIT_MS,
		type ScoreResult
	} from '$lib/game/scoring';
	import { computeWeightedScore, computeNewRating } from '$lib/game/rating';
	import { authClient, signInWithProvider } from '$lib/auth-client';
	import {
		clearPendingGame,
		newSubmissionId,
		readPendingGame,
		writePendingGame
	} from '$lib/game/pending-game';
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
	const emptyScore: ScoreResult = {
		mse: 1,
		clicks: 0,
		score: 0,
		matchPct: 0,
		matchScore: 0,
		timeBonus: 0,
		histogramData: []
	};
	let scoreResult: ScoreResult = $state({ ...emptyScore });

	let startTime = $state(0);
	let elapsedMs = $state(0);
	let timerRunning = $state(false);
	let timerHandle = 0;
	let lastCountdownSecond = 0;
	let showHelp = $state(false);
	let lastAction = $state('');

	let isSubmitting = $state(false);
	let showDialog = $state(false);
	let submitted = $state(false);
	let submittedRank = $state<number | null>(null);
	let submittedSkillLevel = $state<number | null>(null);
	let submittedOldSkillLevel = $state<number | null>(null);
	let submittedTierName = $state<string | null>(null);
	let submittedTierColor = $state<string | null>(null);
	let submittedRankUp = $state(false);
	let expired = $state(false);
	let submissionId = $state('');
	let pendingSubmission = $state(false);
	let submissionError = $state('');
	let signInError = $state('');
	let isSigningIn = $state(false);
	let activeLevel = '';
	let requestSent = false;
	let mounted = false;

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
	let replayCanvas: HTMLCanvasElement | undefined;
	let replayTimer: number | undefined;
	let replayIdx = 0;
	let replayKde: number[] = [];

	// Restore within level initialization, so an initial reset can never erase the snapshot.
	afterNavigate(() => initializeLevel(levelParam));
	beforeNavigate(() => pauseAndPersist());
	onMount(() => {
		mounted = true;
		const unsubscribe = session.subscribe(() => queueMicrotask(maybeAutoSubmit));
		return () => {
			mounted = false;
			unsubscribe();
			stopTimer();
			if (replayTimer) cancelAnimationFrame(replayTimer);
		};
	});

	function initializeLevel(nextLevel: string) {
		if (activeLevel === nextLevel) return;
		stopTimer();
		if (replayTimer) cancelAnimationFrame(replayTimer);
		activeLevel = nextLevel;
		const saved = readPendingGame(nextLevel);
		submissionId = saved?.submissionId ?? newSubmissionId();
		samples = saved?.samples ?? [];
		totalClicks = saved?.totalClicks ?? 0;
		elapsedMs = Math.min(saved?.elapsedMs ?? 0, TIME_LIMIT_MS);
		expired = elapsedMs >= TIME_LIMIT_MS;
		resetCount = saved?.resetCount ?? 0;
		showDialog = (saved?.showDialog ?? false) || (expired && samples.length > 0);
		pendingSubmission = saved?.pendingSubmission ?? false;
		requestSent = saved?.requestSent ?? false;
		isSubmitting = false;
		isSigningIn = false;
		submitted = false;
		submissionError = saved?.requestSent
			? 'Your score has not been confirmed. Retry saving to check it. Your game is preserved.'
			: '';
		signInError = page.url.searchParams.has('error')
			? 'Sign-in was cancelled or failed. Your game is preserved. Try signing in again.'
			: '';
		submittedRank = null;
		submittedSkillLevel = null;
		submittedOldSkillLevel = null;
		submittedTierName = null;
		submittedTierColor = null;
		submittedRankUp = false;
		startTime = 0;
		lastCountdownSecond = 0;
		lastAction = '';
		showHelp = false;
		scoreResult = { ...emptyScore };
		recalcScore();
		if (showDialog) {
			startReplay();
		}
		queueMicrotask(maybeAutoSubmit);
	}

	function persistAttempt(): boolean {
		if (!activeLevel || !submissionId || submitted) return true;
		return writePendingGame({
			version: 2,
			levelParam: activeLevel,
			submissionId,
			samples: [...samples],
			totalClicks,
			elapsedMs,
			resetCount,
			showDialog,
			pendingSubmission,
			requestSent
		});
	}

	function pauseAndPersist() {
		stopTimer();
		if (expired && samples.length > 0 && !showDialog) openSubmit();
		persistAttempt();
	}

	function handleBeforeSignIn(event: Event) {
		if (!activeLevel || (totalClicks === 0 && resetCount === 0) || submitted) return;
		const wasRunning = timerRunning;
		const wasPending = pendingSubmission;
		stopTimer();
		if (expired && samples.length > 0 && !showDialog) openSubmit();
		pendingSubmission = showDialog && samples.length > 0;
		if (!persistAttempt()) {
			event.preventDefault();
			pendingSubmission = wasPending;
			signInError =
				'Your browser could not preserve this game. Enable browser storage and try again.';
			if (wasRunning && !expired) startTimer();
		}
	}

	function handleSignInFailed() {
		pendingSubmission = false;
		signInError = 'Sign-in could not start. Your game is still here. Please try again.';
		persistAttempt();
		if (!showDialog && !requestSent && !expired) startTimer();
	}

	// Session subscriptions also handle OAuth completing after game restoration.
	function maybeAutoSubmit() {
		if (
			!mounted ||
			$session.isPending ||
			!$session.data ||
			!pendingSubmission ||
			!showDialog ||
			submitted ||
			isSubmitting
		)
			return;
		void submitScore();
	}

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
		if (timerRunning || expired || showDialog) return;
		startTime = Date.now() - elapsedMs;
		timerRunning = true;
		tickTimer();
	}

	function tickTimer() {
		if (!timerRunning) return;
		elapsedMs = Math.min(Date.now() - startTime, TIME_LIMIT_MS);
		if (elapsedMs >= TIME_LIMIT_MS) {
			expired = true;
			stopTimer();
			recalcScore(false);
			openSubmit();
			return;
		}
		const secondsLeft = Math.ceil((TIME_LIMIT_MS - elapsedMs) / 1000);
		if (secondsLeft <= 5 && secondsLeft !== lastCountdownSecond) {
			lastCountdownSecond = secondsLeft;
			playCountdown(secondsLeft);
		}
		if (samples.length > 0) recalcScore(false);
		timerHandle = requestAnimationFrame(tickTimer);
	}

	function stopTimer() {
		if (timerRunning) {
			elapsedMs = Math.min(Date.now() - startTime, TIME_LIMIT_MS);
			expired = elapsedMs >= TIME_LIMIT_MS;
			recalcScore(false);
		}
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
		if (!level || expired || showDialog || isSubmitting) return;
		if (!timerRunning) startTimer();
		const previousMatch = scoreResult.matchPct;
		samples = [...samples, x];
		totalClicks++;
		recalcScore();
		const delta = scoreResult.matchPct - previousMatch;
		lastAction =
			delta > 0
				? `Match +${delta} points`
				: delta < 0
					? `Match ${delta} points · Undo to try again`
					: 'Sample added';
		playSample((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0]));
		persistAttempt();
	}

	function handleCanvasSample(x: number) {
		addSample(x);
	}

	function undoLast() {
		if (samples.length === 0 || !level || expired || showDialog || isSubmitting) return;
		if (!timerRunning) startTimer();
		samples = samples.slice(0, -1);
		recalcScore();
		lastAction = 'Last sample removed';
		playUndo();
		persistAttempt();
	}

	function resetSamples() {
		if (isSubmitting || showDialog || expired || samples.length === 0 || !canReset) return;
		playReset();
		lastAction = '';
		lastCountdownSecond = 0;
		stopTimer();
		clearPendingGame(activeLevel, submissionId);
		submissionId = newSubmissionId();
		submitted = false;
		requestSent = false;
		pendingSubmission = false;
		submissionError = '';
		signInError = '';
		samples = [];
		totalClicks = 0;
		scoreResult = { ...emptyScore };
		startTime = 0;
		elapsedMs = 0;
		timerRunning = false;
		expired = false;
		resetCount++;
		persistAttempt();
	}

	function playAgain() {
		if (isSubmitting || isSigningIn) return;
		regenerateLevel();
	}

	function regenerateLevel() {
		// Navigate to a new random generated level
		const newSeed = Date.now();
		const diff = generatedLevel?.targetDifficulty ?? 4.0;
		const diffEncoded = Math.round(diff * 10);
		goto(resolve('/play/[level]', { level: `g-${newSeed.toString(36)}-${diffEncoded}` }));
	}

	function openSubmit() {
		if (samples.length < 1 || showDialog) return;
		stopTimer();
		showDialog = true;
		playSuccess();
		markCompleted(activeLevel);
		startReplay();
		persistAttempt();
	}

	function markCompleted(completedLevel: string) {
		const parsed = parseGeneratedId(completedLevel);
		if (!parsed) return;
		try {
			const key = 'macmac_completed';
			const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
			const seeds = Array.isArray(stored) ? stored.filter((seed) => typeof seed === 'number') : [];
			if (!seeds.includes(parsed.seed)) {
				seeds.push(parsed.seed);
				sessionStorage.setItem(key, JSON.stringify(seeds));
			}
		} catch {
			/* Completion is already saved on the server if browser storage is unavailable. */
		}
	}

	async function signInWith(provider: 'github' | 'google') {
		if (isSigningIn) return;
		isSigningIn = true;
		signInError = '';
		try {
			await signInWithProvider(provider);
		} catch (error) {
			signInError = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
		} finally {
			isSigningIn = false;
		}
	}

	async function submitScore() {
		if (
			!level ||
			!$session.data ||
			samples.length === 0 ||
			isSubmitting ||
			submitted ||
			activeLevel !== levelParam
		)
			return;
		const requestLevel = activeLevel;
		const requestId = submissionId;
		isSubmitting = true;
		pendingSubmission = false;
		requestSent = true;
		submissionError = '';
		pauseAndPersist();
		try {
			const body = {
				submissionId: requestId,
				levelId: requestLevel,
				seed: generatedLevel!.seed,
				targetDifficulty: generatedLevel!.targetDifficulty,
				samples: [...samples],
				duration: elapsedMs,
				clicks: totalClicks
			};
			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const result = await res.json();
			if (!res.ok || result.success !== true) {
				throw new Error(
					res.status === 401
						? 'Your session expired. Sign out and sign in again, then retry. Your game is preserved.'
						: res.status === 409
							? 'Your score is already saved to another account. Sign in to the original account to view it, or choose Play Again for a new attempt.'
							: 'Your score could not be saved. Your game is preserved. Check your connection and retry.'
				);
			}
			clearPendingGame(requestLevel, requestId);
			markCompleted(requestLevel);
			if (activeLevel !== requestLevel || submissionId !== requestId) return;
			submitted = true;
			signInError = '';
			submittedRank = typeof result.rank === 'number' ? result.rank : null;
			submittedSkillLevel = typeof result.skillLevel === 'number' ? result.skillLevel : null;
			submittedOldSkillLevel =
				typeof result.oldSkillLevel === 'number' ? result.oldSkillLevel : null;
			submittedTierName = result.tierName ?? null;
			submittedTierColor = result.tierColor ?? null;
			submittedRankUp = !!result.rankUp;
			if (submittedRankUp) playSuccess();
		} catch (error) {
			if (activeLevel !== requestLevel || submissionId !== requestId) return;
			submissionError =
				error instanceof Error && error.message.startsWith('Your ')
					? error.message
					: 'Your score could not be saved. Your game is preserved. Check your connection and retry.';
			persistAttempt();
		} finally {
			if (activeLevel === requestLevel && submissionId === requestId) isSubmitting = false;
		}
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

	function attachReplayCanvas(canvas: HTMLCanvasElement) {
		replayCanvas = canvas;
		drawReplay();
		return () => {
			if (replayCanvas === canvas) replayCanvas = undefined;
		};
	}

	function startReplay() {
		if (!level) return;
		if (replayTimer) cancelAnimationFrame(replayTimer);
		const [xMin, xMax] = level.xRange;
		replayXs = linspace(xMin, xMax, 200);
		replayIdx = 0;
		replayKde = new Array(200).fill(0);
		replayStepTimer = 0;
		replayPhase = 'adding';
		replayPauseTimer = 0;
		replayFadeTimer = 0;
		replayFadeFactor = 1;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			replayIdx = samples.length;
			replayKde = computeKDE(samples, replayXs);
			drawReplay();
			return;
		}

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
				const targetKde =
					replaySamples.length > 0 ? computeKDE(replaySamples, replayXs) : new Array(200).fill(0);
				for (let i = 0; i < 200; i++) {
					replayKde[i] += (targetKde[i] - replayKde[i]) * 0.12;
				}
			}

			drawReplay();
			replayTimer = requestAnimationFrame(frame);
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
		if (replayCanvas.width !== Math.round(w * dpr) || replayCanvas.height !== Math.round(h * dpr)) {
			replayCanvas.width = Math.round(w * dpr);
			replayCanvas.height = Math.round(h * dpr);
		}
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const style = getComputedStyle(document.documentElement);
		const cyan = style.getPropertyValue('--accent-cyan').trim();
		const orange = style.getPropertyValue('--accent-orange').trim();
		ctx.fillStyle = style.getPropertyValue('--canvas-bg').trim();
		ctx.fillRect(0, 0, w, h);
		const pad = 12;
		const pw = w - pad * 2;
		const ph = h - pad * 2;
		const [xMin, xMax] = level.xRange;
		const target = replayXs.map((x) => level.pdf(x));
		const targetMax = Math.max(...target) || 1;
		const estimateMax = Math.max(...replayKde) || 1;
		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (value: number) => pad + ph - value * ph * 0.88;
		const baseY = toY(0);
		ctx.strokeStyle = style.getPropertyValue('--canvas-axis').trim();
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(pad, baseY);
		ctx.lineTo(pad + pw, baseY);
		ctx.stroke();

		// Both peaks use the same display height, matching the shape-based score.
		ctx.beginPath();
		for (let i = 0; i < replayXs.length; i++) {
			if (i === 0) ctx.moveTo(toX(replayXs[i]), toY(target[i] / targetMax));
			else ctx.lineTo(toX(replayXs[i]), toY(target[i] / targetMax));
		}
		ctx.strokeStyle = cyan;
		ctx.lineWidth = 2.3;
		ctx.lineJoin = 'round';
		ctx.stroke();
		ctx.lineTo(toX(xMax), baseY);
		ctx.lineTo(toX(xMin), baseY);
		ctx.closePath();
		ctx.globalAlpha = 0.06;
		ctx.fillStyle = cyan;
		ctx.fill();
		ctx.globalAlpha = 1;

		if (replayIdx > 0 && replayFadeFactor > 0.01) {
			ctx.globalAlpha = replayFadeFactor;
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				if (i === 0) ctx.moveTo(toX(replayXs[i]), toY(replayKde[i] / estimateMax));
				else ctx.lineTo(toX(replayXs[i]), toY(replayKde[i] / estimateMax));
			}
			ctx.strokeStyle = orange;
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 4]);
			ctx.stroke();
			ctx.setLineDash([]);
			const replaySamples = replayPhase === 'fadingOut' ? samples : samples.slice(0, replayIdx);
			for (const sample of replaySamples) {
				ctx.fillStyle = orange;
				ctx.beginPath();
				ctx.arc(toX(sample), baseY, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		}
	}

	function handleKeyboard(event: KeyboardEvent) {
		if (
			event.defaultPrevented ||
			event.repeat ||
			event.altKey ||
			showDialog ||
			expired ||
			isSubmitting
		)
			return;
		const target = event.target;
		const fromChart = target instanceof Element && target.closest('[data-game-chart]');
		if (
			target instanceof Element &&
			!fromChart &&
			target.closest('input, textarea, select, button, a, [contenteditable="true"]')
		)
			return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
			event.preventDefault();
			undoLast();
		} else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'u') {
			event.preventDefault();
			undoLast();
		} else if (
			!event.ctrlKey &&
			!event.metaKey &&
			event.key === 'Enter' &&
			!fromChart &&
			samples.length > 0
		) {
			event.preventDefault();
			openSubmit();
		} else if (!event.ctrlKey && !event.metaKey && event.key === '?') {
			showHelp = !showHelp;
		}
	}

	const coachingTip = $derived.by(() => {
		if (!showDialog || !level || samples.length === 0) return '';
		const xs = linspace(level.xRange[0], level.xRange[1], 100);
		const target = xs.map((x) => level.pdf(x));
		const estimate = computeKDE(samples, xs);
		const targetMax = Math.max(...target);
		const estimateMax = Math.max(...estimate);
		let biggestGap = 0;
		let gapIndex = 0;
		for (let i = 0; i < xs.length; i++) {
			const gap = target[i] / (targetMax || 1) - estimate[i] / (estimateMax || 1);
			if (Math.abs(gap) > Math.abs(biggestGap)) {
				biggestGap = gap;
				gapIndex = i;
			}
		}
		if (Math.abs(biggestGap) < 0.12)
			return 'A close fit. Next time, finish sooner to earn a bigger time bonus.';
		const region =
			gapIndex < xs.length / 3 ? 'left' : gapIndex > (xs.length * 2) / 3 ? 'right' : 'middle';
		return biggestGap > 0
			? `Next time, try more samples around the ${region} of the curve — your shape is too low there.`
			: `Next time, spread some samples away from the ${region} of the curve — your shape is too high there.`;
	});

	// Display info
	const levelName = $derived(level ? (generatedLevel?.name ?? 'Generated') : 'Not Found');
</script>

<svelte:window
	onkeydown={handleKeyboard}
	onmacmacbeforesignin={handleBeforeSignIn}
	onmacmacsigninfailed={handleSignInFailed}
	onpagehide={pauseAndPersist}
	onbeforeunload={pauseAndPersist}
/>

<svelte:head>
	<title>{levelName} — macmac</title>
</svelte:head>

{#if !level}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="text-center">
			<div class="mb-2" style="color: var(--text-tertiary);">Level not found</div>
			<a href={resolve('/')} class="text-sm" style="color: var(--accent-cyan);">Home</a>
		</div>
	</div>
{:else}
	<div
		class="flex h-dvh flex-col overflow-hidden"
		style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);"
	>
		<AppHeader />

		<div class="solo-guide shrink-0 px-4 pb-2 sm:px-6">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<p class="text-xs font-semibold" style="color: var(--text-primary);">
						Shape the curve <span class="ml-1 font-normal" style="color: var(--text-tertiary);"
							>· Solo · 30s</span
						>
					</p>
					<p class="mt-0.5 text-[11px] sm:text-xs" style="color: var(--text-secondary);">
						{samples.length === 0
							? 'Click anywhere on the chart to start. Aim for the peaks.'
							: 'Build your shape to match the target. Submit when it fits.'}
					</p>
				</div>
				<button
					type="button"
					onclick={() => (showHelp = !showHelp)}
					class="solo-help"
					aria-expanded={showHelp}
					aria-controls="solo-help-details">{showHelp ? 'Close' : 'How to play'}</button
				>
			</div>
			{#if showHelp}
				<div id="solo-help-details" class="solo-help-details">
					<p>
						Each click adds one sample at that horizontal position. Taller peaks need more samples;
						lower areas need fewer. The click height doesn't matter.
					</p>
					<p>
						The timer starts on your first sample. Improve the match, then submit early for a time
						bonus. Undo costs no extra clicks.
					</p>
					<p class="solo-keyboard">
						Chart: <kbd>←</kbd> <kbd>→</kbd> aim · <kbd>Space</kbd> / <kbd>Enter</kbd> place ·
						<kbd>U</kbd> undo. Use Submit to finish.
					</p>
				</div>
			{/if}
		</div>

		<!-- Countdown timer -->
		{#if timerRunning || showDialog || expired}
			<div class="shrink-0 px-4 pt-1 sm:px-6">
				<div class="flex items-center gap-2">
					<div
						class="relative h-2.5 flex-1 overflow-hidden rounded-full"
						style="background: color-mix(in srgb, {timerColor} 12%, var(--surface));"
					>
						<div
							class="absolute inset-y-0 left-0 rounded-full transition-all duration-100"
							style="width: {timerPct *
								100}%; background: linear-gradient(90deg, color-mix(in srgb, {timerColor} 60%, var(--bg)), {timerColor}, color-mix(in srgb, {timerColor} 50%, white)); {timerUrgent
								? `box-shadow: 0 0 10px ${timerColor};`
								: ''}"
						></div>
					</div>
					<span
						class="min-w-[2rem] text-right text-sm font-bold tabular-nums {timerCritical
							? 'timer-critical'
							: ''}"
						style="color: {timerUrgent ? timerColor : 'var(--text-tertiary)'};">{timerDisplay}</span
					>
				</div>
			</div>
		{/if}

		<!-- Score panel -->
		<div class="shrink-0 px-4 pt-1 pb-1 sm:px-6">
			<ScorePanel
				{scoreResult}
				{elapsedMs}
				difficultyMultiplier={generatedLevel ? 0.55 + generatedLevel.targetDifficulty * 0.15 : 1}
			/>
		</div>

		{#if !showDialog && signInError}
			<p
				role="alert"
				class="shrink-0 px-4 pb-1 text-xs sm:px-6"
				style="color: var(--accent-orange);"
			>
				{signInError}
			</p>
		{:else if !showDialog && samples.length > 0 && !timerRunning}
			<p
				role="status"
				class="shrink-0 px-4 pb-1 text-xs sm:px-6"
				style="color: var(--text-secondary);"
			>
				Your game is preserved. Click anywhere on the chart to continue, or submit your score.
			</p>
		{/if}

		<!-- Canvas -->
		<div class="relative min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas
				{level}
				{samples}
				disabled={expired || showDialog || isSubmitting}
				onSampleAdd={handleCanvasSample}
			/>
		</div>

		<!-- Bottom controls -->
		<div class="shrink-0 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-5">
			<div class="solo-feedback" role="status" aria-live="polite">
				<span
					>{lastAction ||
						(samples.length === 0
							? 'Your first click starts the clock'
							: 'Keep shaping — the match updates with every sample')}</span
				>
				<span class="solo-key-hint"><kbd>U</kbd> undo · <kbd>Enter</kbd> finish</span>
			</div>
			<div class="flex items-center justify-between">
				<div class="flex gap-2">
					<!-- Undo -->
					<button
						onclick={undoLast}
						disabled={samples.length === 0 || expired || showDialog || isSubmitting}
						class="btn-action"
						style="--btn-color: var(--accent-purple);"
					>
						<span class="btn-action-face">
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"
								><path
									fill-rule="evenodd"
									d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z"
									clip-rule="evenodd"
								/></svg
							>
							Undo
						</span>
					</button>

					<!-- Reset / Regenerate -->
					{#if canReset}
						<button
							onclick={resetSamples}
							disabled={samples.length === 0 || expired || showDialog || isSubmitting}
							class="btn-action"
							style="--btn-color: var(--accent-orange);"
						>
							<span class="btn-action-face">
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"
									><path
										fill-rule="evenodd"
										d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z"
										clip-rule="evenodd"
									/></svg
								>
								Reset&nbsp;({resetsLeft})
							</span>
						</button>
					{:else}
						<button
							onclick={regenerateLevel}
							class="btn-action"
							style="--btn-color: var(--accent-orange);"
						>
							<span class="btn-action-face">
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"
									><path
										fill-rule="evenodd"
										d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z"
										clip-rule="evenodd"
									/></svg
								>
								Regenerate
							</span>
						</button>
					{/if}
				</div>

				<!-- Submit -->
				<button
					onclick={openSubmit}
					disabled={samples.length < 1 || showDialog || isSubmitting}
					class="btn-action"
					style="--btn-color: var(--accent-cyan);"
				>
					<span class="btn-action-face">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"
							><path
								fill-rule="evenodd"
								d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
								clip-rule="evenodd"
							/></svg
						>
						Submit
					</span>
				</button>
			</div>
		</div>
	</div>

	<!-- Submit dialog (terminal — no dismiss) -->
	{#if showDialog}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
			style="background: var(--overlay);"
		>
			<div
				class="relative mx-4 w-full max-w-sm rounded-2xl p-5 shadow-2xl"
				style="background: var(--bg); border: 1px solid var(--border);"
			>
				<h2 class="mb-1 text-xl font-bold" style="color: var(--text-primary);">
					{expired ? 'Time’s up!' : 'Curve complete'}
				</h2>
				<p class="mb-4 text-xs" style="color: var(--text-secondary);">{coachingTip}</p>

				<!-- Replay -->
				<canvas
					{@attach attachReplayCanvas}
					class="mb-4 h-28 w-full rounded-lg sm:h-36"
					style="background: var(--canvas-bg);"
				></canvas>

				<div
					class="mb-4 flex justify-center gap-5 text-[10px]"
					style="color: var(--text-secondary);"
				>
					<span><span style="color: var(--accent-cyan);">━</span> Target</span>
					<span><span style="color: var(--accent-orange);">┄</span> Your shape</span>
				</div>

				<!-- Stats -->
				<div class="mb-4 flex justify-between text-center">
					<div>
						<div class="text-[9px] tracking-wider uppercase" style="color: var(--text-tertiary);">
							Score
						</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--text-primary);">
							{(weightedScore > 0 ? weightedScore : scoreResult.score).toLocaleString()}
						</div>
					</div>
					<div>
						<div class="text-[9px] tracking-wider uppercase" style="color: var(--text-tertiary);">
							Match
						</div>
						<div class="text-lg font-bold tabular-nums" style="color: #4ade80;">
							{scoreResult.matchPct}%
						</div>
					</div>
					<div>
						<div class="text-[9px] tracking-wider uppercase" style="color: var(--text-tertiary);">
							Clicks
						</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-orange);">
							{totalClicks}
						</div>
					</div>
					<div>
						<div class="text-[9px] tracking-wider uppercase" style="color: var(--text-tertiary);">
							Time
						</div>
						<div class="text-lg font-bold tabular-nums" style="color: var(--accent-cyan);">
							{(elapsedMs / 1000).toFixed(1)}s
						</div>
					</div>
				</div>

				{#if signInError || submissionError}
					<p role="alert" class="mb-3 text-xs" style="color: var(--accent-orange);">
						{signInError || submissionError}
					</p>
				{/if}

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
								<div
									class="flex items-center justify-between text-[9px]"
									style="color: var(--text-tertiary);"
								>
									<span style="color: {tier.color};">{tier.name}</span>
									<span>{Math.round(progress * 100)}%</span>
								</div>
								<div
									class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full"
									style="background: color-mix(in srgb, {tier.color} 15%, var(--surface));"
								>
									<div
										class="h-full rounded-full"
										style="width: {progress * 100}%; background: {tier.color};"
									></div>
								</div>
							</div>
						</div>
					{/if}
					<p class="mb-3 text-center text-xs" style="color: var(--text-tertiary);">
						Sign in to save this score and claim your rank. Your game will be preserved.
					</p>
					<div class="mb-3 flex flex-col gap-2">
						<button
							onclick={() => signInWith('github')}
							disabled={isSigningIn || $session.isPending}
							class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80"
							style="background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border);"
						>
							<Github size={14} /> Continue with GitHub
						</button>
						<button
							onclick={() => signInWith('google')}
							disabled={isSigningIn || $session.isPending}
							class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80"
							style="background: var(--surface); color: var(--text-secondary); border: 1px solid var(--border);"
						>
							<svg viewBox="0 0 24 24" class="h-3.5 w-3.5"
								><path
									d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
									fill="#4285F4"
								/><path
									d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									fill="#34A853"
								/><path
									d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
									fill="#FBBC05"
								/><path
									d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
									fill="#EA4335"
								/></svg
							>
							Continue with Google
						</button>
					</div>
					<div class="flex gap-2">
						<a
							href={resolve('/')}
							class="btn-action flex-1"
							style="--btn-color: var(--text-secondary);"
						>
							<span class="btn-action-face w-full justify-center">Home</span>
						</a>
						<button
							onclick={playAgain}
							disabled={isSubmitting || isSigningIn}
							class="btn-action flex-1"
							style="--btn-color: var(--accent-cyan);"
						>
							<span class="btn-action-face w-full justify-center">Play Again</span>
						</button>
					</div>
				{:else if submitted}
					<!-- Post-submit -->
					<div class="mb-3 text-center text-sm font-semibold" style="color: #4ade80;">
						Score submitted!
					</div>

					<!-- Skill level + rank badge + tier progress -->
					{#if submitted && submittedSkillLevel !== null}
						<div class="mb-4 flex flex-col items-center gap-1.5">
							{#if submittedRankUp && submittedTierName}
								<div
									class="rank-up-anim mb-1 text-center text-xs font-bold tracking-wider uppercase"
									style="color: {submittedTierColor};"
								>
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
										<span
											class="text-[10px] font-semibold tabular-nums"
											style="color: {delta >= 0 ? 'var(--win-green)' : 'var(--loss-red)'};"
										>
											{delta >= 0 ? '+' : ''}{delta}
										</span>
									{/if}
								</div>
							</div>
							<!-- Tier progress bar -->
							<div class="mt-1 w-full max-w-[200px]">
								<div
									class="flex items-center justify-between text-[9px]"
									style="color: var(--text-tertiary);"
								>
									<span style="color: {getSkillTier(submittedSkillLevel).color};"
										>{getSkillTier(submittedSkillLevel).name}</span
									>
									<span>{Math.round(getTierProgress(submittedSkillLevel) * 100)}%</span>
								</div>
								<div
									class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full"
									style="background: color-mix(in srgb, {getSkillTier(submittedSkillLevel)
										.color} 15%, var(--surface));"
								>
									<div
										class="h-full rounded-full transition-all"
										style="width: {getTierProgress(submittedSkillLevel) *
											100}%; background: {getSkillTier(submittedSkillLevel).color};"
									></div>
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
						<a
							href={resolve('/')}
							class="btn-action flex-1"
							style="--btn-color: var(--text-secondary);"
						>
							<span class="btn-action-face w-full justify-center">Home</span>
						</a>
						<button
							onclick={playAgain}
							disabled={isSubmitting || isSigningIn}
							class="btn-action flex-1"
							style="--btn-color: var(--accent-cyan);"
						>
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
									<span
										class="text-[10px] font-semibold tabular-nums"
										style="color: {delta >= 0 ? 'var(--win-green)' : 'var(--loss-red)'};"
									>
										{delta >= 0 ? '+' : ''}{delta}
									</span>
								</div>
							</div>
							<div class="w-full max-w-[200px]">
								<div
									class="flex items-center justify-between text-[9px]"
									style="color: var(--text-tertiary);"
								>
									<span style="color: {newTier.color};">{newTier.name}</span>
									<span>{Math.round(progress * 100)}%</span>
								</div>
								<div
									class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full"
									style="background: color-mix(in srgb, {newTier.color} 15%, var(--surface));"
								>
									<div
										class="h-full rounded-full transition-all"
										style="width: {progress * 100}%; background: {newTier.color};"
									></div>
								</div>
							</div>
						</div>
					{/if}

					<div
						class="mb-4 flex items-center gap-3 rounded-lg px-3 py-2"
						style="background: var(--surface); border: 1px solid var(--border);"
					>
						{#if $session.data.user.image}
							<img src={$session.data.user.image} alt="" class="h-7 w-7 rounded-full" />
						{/if}
						<div class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">
							{$session.data.user.name}
						</div>
					</div>
					<div class="flex gap-2">
						<button
							onclick={submitScore}
							disabled={isSubmitting}
							class="btn-action flex-1"
							style="--btn-color: var(--accent-cyan);"
						>
							<span class="btn-action-face w-full justify-center"
								>{isSubmitting ? 'Saving…' : submissionError ? 'Retry saving' : 'Submit'}</span
							>
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.solo-help {
		flex-shrink: 0;
		padding: 7px 9px;
		border: 1px solid var(--border);
		border-radius: 9px;
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 600;
		cursor: pointer;
	}
	.solo-help:hover {
		background: var(--surface);
		color: var(--text-primary);
	}
	.solo-help:focus-visible {
		outline: 2px solid var(--accent-cyan);
		outline-offset: 3px;
	}
	.solo-help-details {
		margin-top: 10px;
		display: grid;
		gap: 8px;
		max-width: 650px;
		padding: 12px 14px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.5;
	}
	.solo-keyboard {
		color: var(--text-tertiary);
	}
	.solo-feedback {
		min-height: 23px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding-bottom: 7px;
		color: var(--text-secondary);
		font-size: 10px;
	}
	.solo-key-hint {
		flex-shrink: 0;
		color: var(--text-tertiary);
	}
	kbd {
		display: inline-block;
		min-width: 14px;
		padding: 0 3px;
		border: 1px solid var(--border);
		border-radius: 3px;
		background: var(--surface);
		text-align: center;
		font-family: inherit;
		font-size: 9px;
	}
	@media (max-width: 500px) {
		.solo-key-hint {
			display: none;
		}
	}
</style>
