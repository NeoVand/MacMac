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
	import { Github, Check, CircleHelp, RotateCcw, Undo2 } from 'lucide-svelte';
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
							? 'Your score is already saved to another account. Sign in to the original account to view it, or choose Play again for a new attempt.'
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
		ctx.fillStyle = style.getPropertyValue('--surface').trim();
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

	const mobileScore = $derived(
		Math.round(
			scoreResult.score * (generatedLevel ? 0.55 + generatedLevel.targetDifficulty * 0.15 : 1)
		)
	);

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
	<div class="solo-game">
		<AppHeader />
		<main class="solo-arena">
			<div class="arena-heading">
				<div>
					<h1>Solo run <span class="level-name">{levelName}</span></h1>
					<p>
						{samples.length === 0
							? 'Place your first sample to start the clock.'
							: 'Shape your samples to match the target.'}
					</p>
				</div>
				<button
					type="button"
					onclick={() => (showHelp = !showHelp)}
					class="arena-help"
					aria-expanded={showHelp}
					aria-controls="solo-help-details"
					><CircleHelp size={16} />{showHelp ? 'Close guide' : 'How to play'}</button
				>
			</div>
			{#if showHelp}
				<div id="solo-help-details" class="solo-help-details">
					<p>
						Click anywhere in the chart to place a sample. Higher peaks need more samples; lower
						areas need fewer. Only the horizontal position matters.
					</p>
					<p>
						You have 30 seconds from the first sample. Get a close match, then finish early for a
						time bonus.
					</p>
					<p class="solo-keyboard">
						Chart: <kbd>←</kbd> <kbd>→</kbd> aim <span> / </span><kbd>Space</kbd> place
						<span> / </span><kbd>U</kbd> undo
					</p>
				</div>
			{/if}

			<div class="arena-hud">
				<div class="arena-score">
					<ScorePanel
						{scoreResult}
						{elapsedMs}
						showTime={false}
						difficultyMultiplier={generatedLevel
							? 0.55 + generatedLevel.targetDifficulty * 0.15
							: 1}
					/>
				</div>
				<div class="mobile-score">
					<span>Score</span><strong>{mobileScore.toLocaleString()}</strong>
				</div>
				<div class="mobile-match">
					<span>Match</span><strong>{scoreResult.matchPct}<small>%</small></strong>
				</div>
				<div
					class="arena-timer"
					data-urgent={timerUrgent}
					data-critical={timerCritical}
					style:--timer-color={timerColor}
				>
					<div class="arena-timer-label">
						<span
							>{timerRunning
								? 'Time remaining'
								: expired || showDialog
									? 'Run finished'
									: samples.length > 0
										? 'Paused'
										: 'Ready to play'}</span
						><span class="timer-state-dot"></span>
					</div>
					<div class="arena-timer-number">{Math.ceil(timeLeftMs / 1000)}<span>s</span></div>
					<div class="arena-time-track" aria-hidden="true">
						<div style:width="{timerPct * 100}%"></div>
					</div>
				</div>
			</div>

			{#if !showDialog && signInError}
				<p role="alert" class="arena-notice">{signInError}</p>
			{:else if !showDialog && samples.length > 0 && !timerRunning}
				<p role="status" class="arena-notice">
					Your run is preserved. Click the chart to continue, or finish now.
				</p>
			{/if}

			<div class="solo-stage">
				<GameCanvas
					{level}
					{samples}
					disabled={expired || showDialog || isSubmitting}
					onSampleAdd={handleCanvasSample}
				/>
			</div>

			<div class="arena-controls">
				<div class="arena-tools">
					<button
						type="button"
						onclick={undoLast}
						disabled={samples.length === 0 || expired || showDialog || isSubmitting}
						class="arena-tool"><Undo2 size={17} /><span>Undo</span><kbd>U</kbd></button
					>
					{#if canReset}
						<button
							type="button"
							onclick={resetSamples}
							disabled={samples.length === 0 || expired || showDialog || isSubmitting}
							class="arena-tool"
							><RotateCcw size={16} /><span>Reset</span><span class="reset-count">{resetsLeft}</span
							></button
						>
					{:else}
						<button type="button" onclick={regenerateLevel} class="arena-tool"
							><RotateCcw size={16} /><span>New curve</span></button
						>
					{/if}
				</div>
				<div class="solo-feedback" role="status" aria-live="polite">
					{lastAction ||
						(samples.length === 0
							? 'The clock starts with your first sample.'
							: 'Every sample changes your shape.')}
				</div>
				<button
					type="button"
					onclick={openSubmit}
					disabled={samples.length < 1 || showDialog || isSubmitting}
					class="arena-finish"><Check size={18} />Finish run</button
				>
			</div>
		</main>
	</div>

	<!-- Finished-run results keep the next action beside the core summary. -->
	{#if showDialog}
		<div class="result-overlay" style="background: var(--overlay);">
			<div
				class="result-shell"
				role="dialog"
				aria-modal="true"
				aria-labelledby="solo-result-heading"
			>
				<div class="result-title-row">
					<h2 id="solo-result-heading" class="result-heading">
						{expired ? 'Time’s up' : 'Run complete'}
					</h2>
					{#if submitted}<span class="result-saved">Score saved</span>{/if}
				</div>
				<div class="result-score">
					<span>Final score</span><strong
						>{(weightedScore > 0 ? weightedScore : scoreResult.score).toLocaleString()}</strong
					>
				</div>
				<canvas {@attach attachReplayCanvas} class="result-replay" style="background: transparent;"
				></canvas>
				<div class="result-legend" style="color: var(--text-secondary);">
					<span><span style="color: var(--accent-cyan);">━</span> Target</span><span
						><span style="color: var(--accent-orange);">┄</span> Your shape</span
					>
				</div>
				<div class="result-stats">
					<div>
						<span>Shape match</span><strong style="color: var(--accent-cyan);"
							>{scoreResult.matchPct}<small>%</small></strong
						>
					</div>
					<div><span>Clicks</span><strong>{totalClicks}</strong></div>
					<div>
						<span>Time used</span><strong>{(elapsedMs / 1000).toFixed(1)}<small>s</small></strong>
					</div>
				</div>
				<div class="result-actions">
					{#if $session.data && !submitted}
						<button
							type="button"
							onclick={submitScore}
							disabled={isSubmitting || isSigningIn}
							class="result-button result-save"
							>{isSubmitting ? 'Saving…' : submissionError ? 'Retry saving' : 'Save score'}</button
						>
					{:else}
						<a href={resolve('/')} class="result-button result-home">Home</a>
					{/if}
					<button
						type="button"
						onclick={playAgain}
						disabled={isSubmitting || isSigningIn}
						class="result-button result-primary">Play again</button
					>
				</div>
				<details class="result-details" open={Boolean(signInError || submissionError)}>
					<summary
						>{!$session.data ? 'Save score, rank & tips' : 'Rank & tips'}<span aria-hidden="true"
							>⌄</span
						></summary
					>
					<div class="result-details-body">
						<p class="result-coaching">{coachingTip}</p>
						{#if signInError || submissionError}<p
								role="alert"
								class="mb-3 text-xs"
								style="color: var(--accent-orange);"
							>
								{signInError || submissionError}
							</p>{/if}
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
									class="result-auth"
									style="background: var(--surface-raised); color: var(--text-secondary);"
								>
									<Github size={14} /> Save with GitHub
								</button>
								<button
									onclick={() => signInWith('google')}
									disabled={isSigningIn || $session.isPending}
									class="result-auth"
									style="background: var(--surface-raised); color: var(--text-secondary);"
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
									Save with Google
								</button>
							</div>
						{:else if submitted}
							<!-- Post-submit -->
							<div class="mb-3 text-center text-sm font-semibold" style="color: var(--win-green);">
								Score saved
							</div>

							<!-- Skill level + rank badge + tier progress -->
							{#if submitted && submittedSkillLevel !== null}
								<div class="mb-4 flex flex-col items-center gap-1.5">
									{#if submittedRankUp && submittedTierName}
										<div
											class="rank-up-anim mb-1 text-center text-xs font-bold tracking-wider uppercase"
											style="color: {submittedTierColor};"
										>
											New rank: {submittedTierName}
										</div>
									{/if}
									<div class="flex items-center gap-2">
										<RankBadge skillLevel={submittedSkillLevel} size="lg" />
										<div class="flex flex-col">
											<span
												class="text-lg font-bold tabular-nums"
												style="color: {submittedTierColor};"
											>
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

							<div class="mb-4 flex items-center gap-3 rounded-lg px-3 py-2">
								{#if $session.data.user.image}
									<img src={$session.data.user.image} alt="" class="h-7 w-7 rounded-full" />
								{/if}
								<div class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">
									{$session.data.user.name}
								</div>
							</div>
						{/if}
						{#if $session.data && !submitted}<a href={resolve('/')} class="result-back-home"
								>Back to home</a
							>{/if}
					</div>
				</details>
			</div>
		</div>
	{/if}
{/if}

<style>
	.mobile-score,
	.mobile-match {
		display: none;
	}
	.result-title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.result-saved {
		color: var(--win-green);
		font-size: 11px;
	}
	.result-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 7px;
	}
	.result-save {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
	.result-details {
		margin-top: 12px;
	}
	.result-details summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 44px;
		list-style: none;
		color: var(--text-secondary);
		font-size: 12px;
		cursor: pointer;
	}
	.result-details summary::-webkit-details-marker {
		display: none;
	}
	.result-details summary span {
		font-size: 18px;
	}
	.result-details[open] summary span {
		transform: rotate(180deg);
	}
	.result-details summary:focus-visible {
		outline: none;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	.result-details-body {
		padding-top: 3px;
	}
	.result-details-body .result-coaching {
		margin: 0 0 18px;
	}
	.result-back-home {
		display: block;
		min-height: 44px;
		padding: 13px 0;
		color: var(--text-secondary);
		text-align: center;
		font-size: 12px;
	}

	.solo-game {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		overflow: hidden;
		background: var(--bg);
	}
	.solo-arena {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		width: 100%;
		max-width: 1440px;
		margin: 0 auto;
		padding: 4px clamp(16px, 3vw, 40px) max(20px, env(safe-area-inset-bottom));
	}
	.arena-heading {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		margin-bottom: 14px;
	}
	.arena-heading h1 {
		margin: 0;
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -1px;
	}
	.level-name {
		display: inline-block;
		margin-left: 12px;
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0;
	}
	.arena-heading p {
		margin-top: 5px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.arena-help {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		flex-shrink: 0;
		padding: 0 12px;
		color: var(--text-secondary);
		font-size: 12px;
		cursor: pointer;
		border-radius: 9px;
	}
	.arena-help:hover {
		color: var(--text-primary);
		background: var(--surface);
	}
	.solo-help-details {
		display: grid;
		gap: 8px;
		padding: 4px 0 14px;
		margin: -4px 0 14px;

		background: transparent;
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.6;
	}
	.solo-help-details p {
		max-width: 78ch;
	}
	.solo-keyboard {
		color: var(--text-tertiary);
	}
	.solo-keyboard span {
		padding: 0 6px;
	}
	.arena-hud {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 28px;
		padding: 14px 0;
		margin-bottom: 14px;

		border-radius: 0;
		background: transparent;
	}
	.arena-score {
		min-width: 0;
	}
	.arena-timer {
		width: 154px;
		flex-shrink: 0;
		color: var(--text-primary);
	}
	.arena-timer-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 11px;
		color: var(--text-secondary);
	}
	.timer-state-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--timer-color);
	}
	.arena-timer-number {
		margin-top: 2px;
		font-family: var(--font-display);
		font-size: 35px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -1.5px;
		font-variant-numeric: tabular-nums;
	}
	.arena-timer-number span {
		margin-left: 4px;
		font-size: 17px;
		font-weight: 400;
		letter-spacing: 0;
		color: var(--text-tertiary);
	}
	.arena-time-track {
		height: 3px;
		margin-top: 8px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--border);
	}
	.arena-time-track div {
		height: 100%;
		background: var(--timer-color);
		transition: width 100ms linear;
	}
	.arena-timer[data-urgent='true'] .arena-timer-number {
		color: var(--timer-color);
	}
	.arena-timer[data-critical='true'] .arena-timer-label {
		color: var(--timer-color);
	}
	.arena-notice {
		margin: 0 0 10px;
		flex-shrink: 0;
		font-size: 12px;
		color: var(--accent-orange);
	}
	.solo-stage {
		position: relative;
		min-height: 0;
		flex: 1;
	}
	.arena-controls {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 22px;
		padding-top: 17px;
	}
	.arena-tools {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.arena-tool {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 45px;
		padding: 0 14px;

		border-radius: 10px;
		color: var(--text-secondary);
		background: transparent;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.arena-tool:hover:enabled {
		background: var(--surface);
		color: var(--text-primary);
	}
	.arena-tool:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.reset-count {
		font-variant-numeric: tabular-nums;
		padding: 0 5px;
		border-radius: 4px;
		background: var(--surface);
		color: var(--text-tertiary);
		font-size: 10px;
	}
	.solo-feedback {
		color: var(--text-secondary);
		font-size: 12px;
		text-align: center;
	}
	.arena-finish {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		flex-shrink: 0;
		min-height: 46px;
		min-width: 146px;
		padding: 0 20px;
		border-radius: 11px;
		background: var(--accent-cyan);
		color: var(--on-accent);
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.arena-finish:hover:enabled {
		filter: brightness(1.08);
	}
	.arena-finish:disabled {
		background: var(--surface);
		color: var(--text-tertiary);
		cursor: default;
	}
	.arena-help:focus-visible,
	.arena-tool:focus-visible,
	.arena-finish:focus-visible,
	.result-button:focus-visible,
	.result-auth:focus-visible {
		outline: none;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	kbd {
		display: inline-block;
		min-width: 17px;
		padding: 1px 4px;

		border-radius: 4px;
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: 10px;
		text-align: center;
	}
	.result-overlay {
		position: fixed;
		inset: 0;
		z-index: 80;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		backdrop-filter: blur(12px);
	}
	.result-shell {
		position: relative;
		width: 100%;
		max-width: 500px;
		max-height: calc(100dvh - 32px);
		overflow-y: auto;
		padding: 26px;

		border-radius: 20px;
		background: var(--surface);
		color: var(--text-primary);
		box-shadow: 0 30px 100px #0005;
	}
	.result-heading {
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.8px;
	}
	.result-score {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 18px 0 22px;
	}
	.result-score span {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.result-score strong {
		font-family: var(--font-display);
		font-size: 46px;
		font-weight: 600;
		line-height: 1;
		letter-spacing: -2px;
		font-variant-numeric: tabular-nums;
	}
	.result-replay {
		width: 100%;
		height: 145px;

		border-radius: 0;
	}
	.result-legend {
		display: flex;
		justify-content: center;
		gap: 24px;
		padding: 10px 0 17px;
		font-size: 11px;
	}
	.result-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		padding: 17px 0;
	}
	.result-stats div {
		display: grid;
		gap: 5px;
		text-align: center;
	}
	.result-stats span {
		color: var(--text-secondary);
		font-size: 11px;
	}
	.result-stats strong {
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.7px;
		font-variant-numeric: tabular-nums;
	}
	.result-stats small {
		margin-left: 2px;
		font-size: 14px;
	}
	.result-coaching {
		margin: 16px 0 20px;
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.6;
	}
	.result-auth {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		min-height: 42px;
		width: 100%;
		border-radius: 9px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.result-button {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		min-height: 44px;
		padding: 0 16px;
		border-radius: 10px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.result-home {
		color: var(--text-secondary);
	}
	.result-primary {
		background: var(--accent-cyan);
		color: var(--on-accent);
	}
	.result-button:hover:enabled,
	.result-auth:hover:enabled {
		filter: brightness(1.08);
	}
	.result-button:disabled,
	.result-auth:disabled {
		opacity: 0.45;
		cursor: default;
	}
	@media (max-width: 640px) {
		.solo-arena {
			padding: 0 12px max(10px, env(safe-area-inset-bottom));
		}
		.arena-heading {
			min-height: 40px;
			margin-bottom: 6px;
			gap: 8px;
		}
		.arena-heading h1 {
			font-size: 20px;
		}
		.arena-heading p {
			display: none;
		}
		.level-name {
			margin-left: 8px;
			font-size: 10px;
		}
		.arena-help {
			width: 44px;
			height: 44px;
			min-height: 44px;
			padding: 0;
			font-size: 0;
			gap: 0;
		}
		.arena-help :global(svg) {
			width: 19px;
			height: 19px;
		}
		.solo-help-details {
			position: absolute;
			z-index: 70;
			top: 46px;
			left: 12px;
			right: 12px;
			max-height: calc(100dvh - 130px);
			overflow-y: auto;
			margin: 0;
			padding: 16px;
			border-radius: 14px;
			background: var(--surface);
			box-shadow: 0 12px 45px #0004;
		}
		.arena-hud {
			display: grid;
			grid-template-columns: 1fr 1fr 84px;
			align-items: center;
			gap: 14px;
			padding: 7px 0 11px;
			margin-bottom: 5px;
		}
		.arena-score {
			display: none;
		}
		.mobile-score,
		.mobile-match {
			display: flex;
			flex-direction: column;
			gap: 4px;
			min-width: 0;
		}
		.mobile-score > span,
		.mobile-match > span {
			color: var(--text-secondary);
			font-size: 10px;
		}
		.mobile-score strong {
			font-family: var(--font-display);
			font-size: 28px;
			font-weight: 600;
			line-height: 1;
			letter-spacing: -1px;
			font-variant-numeric: tabular-nums;
		}
		.mobile-match strong {
			font-family: var(--font-display);
			font-size: 24px;
			font-weight: 600;
			line-height: 1;
			color: var(--accent-cyan);
			font-variant-numeric: tabular-nums;
		}
		.mobile-match small {
			margin-left: 2px;
			font-size: 15px;
		}
		.arena-timer {
			width: 84px;
		}
		.arena-timer-label {
			font-size: 9px;
		}
		.arena-timer-number {
			font-size: 30px;
		}
		.arena-timer-number span {
			font-size: 14px;
		}
		.arena-controls {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 1.05fr;
			align-items: center;
			gap: 7px 10px;
			padding-top: 10px;
		}
		.arena-tools {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 2px;
			min-width: 0;
		}
		.arena-tool {
			min-width: 0;
			min-height: 46px;
			padding: 0 3px;
			gap: 4px;
			font-size: 11px;
		}
		.arena-tool kbd {
			display: none;
		}
		.reset-count {
			padding: 0 2px;
			font-size: 9px;
		}
		.arena-finish {
			width: 100%;
			min-width: 0;
			min-height: 46px;
			padding: 0 8px;
			font-size: 12px;
		}
		.solo-feedback {
			grid-column: 1 / -1;
			grid-row: 2;
			min-height: 12px;
			font-size: 10px;
			text-align: left;
		}
		.result-overlay {
			padding: 10px;
		}
		.result-shell {
			max-height: calc(100dvh - 20px);
			padding: 18px;
		}
		.result-heading {
			font-size: 22px;
		}
		.result-score {
			padding: 14px 0 17px;
		}
		.result-score strong {
			font-size: 40px;
		}
		.result-replay {
			height: 112px;
		}
		.result-legend {
			padding: 8px 0 10px;
		}
		.result-stats {
			padding: 10px 0;
		}
		.result-stats strong {
			font-size: 22px;
		}
		.result-actions {
			margin-top: 9px;
		}
		.result-button {
			min-height: 46px;
			padding: 0 10px;
			font-size: 12px;
		}
		.result-details {
			margin-top: 6px;
		}
	}
	@media (max-width: 640px) and (max-height: 620px) {
		.arena-heading {
			margin-bottom: 0;
		}
		.arena-hud {
			padding-top: 3px;
			padding-bottom: 8px;
			margin-bottom: 3px;
		}
		.result-shell {
			padding: 15px 17px;
		}
		.result-score {
			padding: 10px 0 14px;
		}
		.result-replay {
			height: 98px;
		}
		.result-stats {
			padding: 9px 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.arena-time-track div {
			transition: none;
		}
	}
</style>
