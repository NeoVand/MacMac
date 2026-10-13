<script lang="ts">
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { reconstructLevel } from '$lib/game/generator';
	import { getFullScore, type ScoreResult } from '$lib/game/scoring';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import { normalizeShape } from '$lib/game/plot-interaction';
	import { joinBattle } from '$lib/battle/client';
	import type { BattleEndMessage, ServerMessage } from '$lib/battle/protocol';
	import type { Level } from '$lib/game/levels';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { getBattleTier, getBattleTierProgress } from '$lib/game/elo';
	import { authClient, preventSignIn, signInWithProvider } from '$lib/auth-client';
	import {
		clearPendingBattle,
		readPendingBattle,
		writePendingBattle
	} from '$lib/game/pending-battle';
	import { resolvePlayerName } from '$lib/utils/player-name';
	import { Github, Swords, Eye, EyeOff, Play, Trophy, ArrowLeft, RotateCcw } from 'lucide-svelte';
	import { unlockAudio, playSample, playCountdown, playRoundStart, playOutcome } from '$lib/audio';

	const session = authClient.useSession();
	const battleId = $derived(page.params.id ?? '');

	// Battle state
	type Phase = 'connecting' | 'waiting' | 'countdown' | 'playing' | 'ended' | 'expired';
	let phase = $state<Phase>('connecting');
	let countdownNum = $state(3);
	let level = $state<Level | null>(null);
	let samples: number[] = $state([]);
	let opponentKde: number[] = $state([]);
	let opponentMatchPct = $state(0);
	let opponentName = $state('Opponent');
	let opponentElo = $state(1200);
	let opponentCountry = $state<string | null>(null);
	let durationMs = $state(20000);
	let timeLeftMs = $state(20000);
	let compareOpponent = $state(true);
	let lastTimerSecond = 0;
	let lastAcceptedSampleAt = 0;
	let timerHandle = 0;
	let startTime = 0;

	// Results
	let won = $state(false);
	let winnerId = $state('');
	let winnerName = $state('');
	let yourScore = $state(0);
	let yourMatchPct_result = $state(0);
	let opponentScore = $state(0);
	let opponentMatchPct_result = $state(0);
	let yourEloDelta = $state(0);
	let isJackpot = $state(false);
	let jackpotMatchPct = $state(0);
	let battleTierName = $state<string | null>(null);
	let battleTierColor = $state<string | null>(null);
	let battleRankUp = $state(false);
	let reportedNewElo = $state<number | null>(null);
	let opponentSamples = $state<number[]>([]);
	let isSigningIn = $state(false);
	let signInError = $state('');
	let isReporting = $state(false);
	let reportSaved = $state(false);
	let reportError = $state('');
	let activeBattle = '';
	let connectedPlayerId = '';
	let battleSeed = 0;
	let battleDifficulty = 0;
	let completedResult = $state.raw<BattleEndMessage | null>(null);
	let pendingReport = false;
	let requestSent = false;
	let mounted = false;
	let connTimeout: ReturnType<typeof setTimeout> | undefined;
	let viewportWidth = $state(0);
	let rankingExpanded = $state(false);

	// Results show the complete shapes first; the build replay is opt-in.
	let replayCanvas: HTMLCanvasElement | undefined;
	let replayTimer = 0;
	let showYou = $state(true);
	let showOpponent = $state(true);
	let replayPlaying = $state(false);
	let replayIdx = 0;
	let yourReplayKde: number[] = [];
	let oppReplayKde: number[] = [];
	let replayXs: number[] = [];
	let replayOpacity = 1;
	const REPLAY_STEP_MS = 300;
	const REPLAY_START_DELAY_MS = 200;
	const REPLAY_HOLD_MS = 2000;
	const REPLAY_FADE_MS = 550;
	const REPLAY_EASE_MS = 130;

	// Score tracking
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

	let socket: ReturnType<typeof joinBattle> | null = null;

	const anonId = crypto.randomUUID();
	const myPlayerId = $derived($session.data?.user?.id ?? 'anon-' + anonId);
	const myName = $derived(resolvePlayerName($session.data?.user?.name ?? 'Anonymous'));
	const isWinner = $derived(won);
	const isAnonymous = $derived(!$session.data?.user);

	// For anonymous users, show hypothetical rank (starting ELO = 1200)
	const anonElo = $derived(1200 + yourEloDelta);

	const timerDisplay = $derived.by(() => {
		const sec = Math.max(0, Math.ceil(timeLeftMs / 1000));
		return `${sec}s`;
	});
	const battleTimerPct = $derived(timeLeftMs / durationMs);
	const battleTimerColor = $derived.by(() => {
		if (battleTimerPct > 0.5) return 'var(--accent-cyan)';
		if (battleTimerPct > 0.2) return 'var(--accent-orange)';
		return 'var(--accent-red)';
	});

	const battleTimerCritical = $derived(timeLeftMs <= 5000);
	const matchGap = $derived(scoreResult.matchPct - opponentMatchPct);
	const battleStanding = $derived(
		timeLeftMs <= 0
			? 'Time is up. Comparing final shapes…'
			: samples.length >= 200
				? '200 samples placed. Your shape is locked.'
				: samples.length === 0 && opponentKde.length === 0
					? 'Make the first move'
					: matchGap === 0
						? 'Shapes are neck and neck'
						: matchGap > 0
							? `Your match leads by ${matchGap} ${matchGap === 1 ? 'point' : 'points'}`
							: `Close the ${Math.abs(matchGap)} point gap`
	);
	const scoreMargin = $derived(Math.abs(yourScore - opponentScore));

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

	function handleBeforeSignIn(event: Event) {
		if (phase !== 'ended' && phase !== 'expired') {
			signInError =
				'Finish this battle before signing in. Signing in now would disconnect you, and an active battle cannot be resumed.';
			preventSignIn(event, signInError);
			return;
		}
		if (phase !== 'ended' || reportSaved) return;
		pendingReport = !!completedResult?.resultToken;
		if (!persistBattleResult()) {
			signInError =
				'Your browser could not preserve this battle result. Enable browser storage and try again.';
			preventSignIn(event, signInError);
		}
	}

	function handleSignInFailed() {
		pendingReport = false;
		signInError = 'Sign-in could not start. Your battle result is preserved. Please try again.';
		persistBattleResult();
	}

	function persistBattleResult(): boolean {
		if (phase !== 'ended' || !completedResult || reportSaved) return true;
		return writePendingBattle({
			version: 1,
			battleId: activeBattle,
			playerId: connectedPlayerId,
			seed: battleSeed,
			targetDifficulty: battleDifficulty,
			durationMs,
			result: { ...completedResult, opponentSamples: [...opponentSamples] },
			samples: [...samples],
			opponentName,
			opponentElo,
			opponentCountry,
			isJackpot,
			jackpotMatchPct,
			showYou,
			showOpponent,
			pendingReport,
			requestSent
		});
	}

	function toggleReplay(which: 'you' | 'opponent') {
		if (which === 'you') showYou = !showYou;
		else showOpponent = !showOpponent;
		drawBattleReplay();
		persistBattleResult();
	}

	function handleRankingToggle(event: Event) {
		if (viewportWidth <= 760 && event.currentTarget instanceof HTMLDetailsElement) {
			rankingExpanded = event.currentTarget.open;
		}
	}

	function countryFlag(code: string | null): string {
		if (!code || !/^[a-z]{2}$/i.test(code)) return '';
		return String.fromCodePoint(
			...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
		);
	}

	function handleMessage(msg: ServerMessage) {
		if (phase === 'ended') return;
		switch (msg.type) {
			case 'waiting':
				phase = 'waiting';
				break;

			case 'countdown':
				phase = 'countdown';
				countdownNum = msg.seconds;
				playCountdown(msg.seconds);
				break;

			case 'start': {
				battleSeed = msg.seed;
				battleDifficulty = msg.targetDifficulty;
				const gen = reconstructLevel(msg.seed, msg.targetDifficulty);
				level = gen;
				opponentName = msg.opponentName;
				opponentElo = msg.opponentElo;
				opponentCountry = msg.opponentCountry ?? null;
				durationMs = msg.durationMs;
				timeLeftMs = msg.durationMs;
				samples = [];
				compareOpponent = true;
				showOpponent = true;
				opponentKde = [];
				opponentMatchPct = 0;
				scoreResult = { ...emptyScore };
				phase = 'playing';
				startTime = Date.now();
				lastTimerSecond = Math.ceil(durationMs / 1000);
				lastAcceptedSampleAt = 0;
				playRoundStart();
				startCountdownTimer();
				break;
			}

			case 'opponent_kde':
				opponentKde = msg.kde;
				opponentMatchPct = msg.matchPct;
				break;

			case 'jackpot':
				isJackpot = true;
				winnerId = msg.winnerId;
				winnerName = msg.winnerName;
				jackpotMatchPct = msg.winnerMatchPct;
				// battle_end will follow with full results
				break;

			case 'battle_end': {
				phase = 'ended';
				winnerId = msg.winnerId;
				winnerName = msg.winnerName;
				yourEloDelta = msg.yourEloDelta;
				opponentSamples = msg.opponentSamples ?? [];

				// New server sends personalized fields; old server sends winner/loser fields.
				// Support both for backwards compatibility during deploy rollout.
				const raw = msg as unknown as Record<string, unknown>;
				if (typeof msg.won === 'boolean') {
					// New format — server tells us directly
					won = msg.won;
					yourScore = msg.yourScore;
					yourMatchPct_result = msg.yourMatchPct;
					opponentScore = msg.opponentScore;
					opponentMatchPct_result = msg.opponentMatchPct;
				} else {
					// Legacy format — derive from winnerId (best-effort)
					won = msg.winnerId === myPlayerId;
					const ws = (raw.winnerScore as number) ?? 0;
					const wm = (raw.winnerMatchPct as number) ?? 0;
					const ls = (raw.loserScore as number) ?? 0;
					const lm = (raw.loserMatchPct as number) ?? 0;
					yourScore = won ? ws : ls;
					yourMatchPct_result = won ? wm : lm;
					opponentScore = won ? ls : ws;
					opponentMatchPct_result = won ? lm : wm;
				}

				stopCountdownTimer();
				playOutcome(won ? 'win' : 'loss');
				completedResult = {
					type: 'battle_end',
					won,
					winnerId,
					winnerName,
					yourScore,
					yourMatchPct: yourMatchPct_result,
					opponentScore,
					opponentMatchPct: opponentMatchPct_result,
					yourEloDelta,
					resultToken: msg.resultToken,
					opponentSamples: [...opponentSamples]
				};
				pendingReport = !!msg.resultToken;
				persistBattleResult();
				maybeSyncSession();
				startBattleReplay();
				break;
			}

			case 'error':
				console.error('Battle error:', msg.message);
				if (msg.message === 'Battle has ended') {
					phase = 'expired';
				}
				break;
		}
	}

	function startCountdownTimer() {
		stopCountdownTimer();
		function tick() {
			const elapsed = Date.now() - startTime;
			timeLeftMs = Math.max(0, durationMs - elapsed);
			const second = Math.ceil(timeLeftMs / 1000);
			if (second !== lastTimerSecond && second > 0 && second <= 5) playCountdown(second);
			lastTimerSecond = second;
			if (timeLeftMs <= 0 || phase !== 'playing') return;
			timerHandle = requestAnimationFrame(tick);
		}
		tick();
	}

	function stopCountdownTimer() {
		cancelAnimationFrame(timerHandle);
	}

	async function reportBattleResult() {
		const resultToken = completedResult?.resultToken;
		if (
			!resultToken ||
			isAnonymous ||
			$session.isPending ||
			isReporting ||
			reportSaved ||
			phase !== 'ended'
		)
			return;
		const requestBattle = activeBattle;
		isReporting = true;
		pendingReport = false;
		requestSent = true;
		reportError = '';
		persistBattleResult();
		try {
			const res = await fetch('/api/battles/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ resultToken })
			});
			const data = await res.json();
			if (!res.ok || data.success !== true) {
				throw new Error(
					res.status === 409
						? 'Your battle result is already saved to another account. Sign in to the original account to view it.'
						: res.status === 401
							? 'Your session expired. Sign in again, then retry saving. Your replay is preserved.'
							: res.status === 400 || res.status === 403
								? 'Your battle result could not be claimed. Its signed claim may have expired. The replay is preserved; you can retry or start a new battle.'
								: 'Your battle result could not be saved. It is preserved. Check your connection and retry saving.'
				);
			}
			clearPendingBattle(requestBattle, resultToken);
			if (activeBattle !== requestBattle || completedResult?.resultToken !== resultToken) return;
			reportSaved = true;
			signInError = '';
			if (data.tierName) battleTierName = data.tierName;
			if (data.tierColor) battleTierColor = data.tierColor;
			battleRankUp = !!data.rankUp;
			if (typeof data.newElo === 'number') reportedNewElo = data.newElo;
		} catch (error) {
			if (activeBattle !== requestBattle || completedResult?.resultToken !== resultToken) return;
			reportError =
				error instanceof Error && error.message.startsWith('Your ')
					? error.message
					: 'Your battle result could not be saved. It is preserved. Check your connection and retry saving.';
			persistBattleResult();
		} finally {
			if (activeBattle === requestBattle && completedResult?.resultToken === resultToken)
				isReporting = false;
		}
	}

	function attachReplayCanvas(canvas: HTMLCanvasElement) {
		replayCanvas = canvas;
		const resizeObserver = new ResizeObserver(drawBattleReplay);
		resizeObserver.observe(canvas);
		const themeObserver = new MutationObserver(drawBattleReplay);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class']
		});
		drawBattleReplay();
		return () => {
			resizeObserver.disconnect();
			themeObserver.disconnect();
			if (replayCanvas === canvas) replayCanvas = undefined;
		};
	}

	function replayTargets() {
		return {
			you: normalizeShape(computeKDE(samples.slice(0, replayIdx), replayXs)),
			opponent: normalizeShape(computeKDE(opponentSamples.slice(0, replayIdx), replayXs))
		};
	}

	function updateReplayShapes() {
		const targets = replayTargets();
		yourReplayKde = targets.you;
		oppReplayKde = targets.opponent;
	}

	function startBattleReplay() {
		if (!level) return;
		cancelAnimationFrame(replayTimer);
		replayPlaying = false;
		replayOpacity = 1;
		replayXs = linspace(...level.xRange, 200);
		replayIdx = Math.max(samples.length, opponentSamples.length);
		updateReplayShapes();
		drawBattleReplay();
	}

	function easeReplayShape(display: number[], target: number[], amount: number): boolean {
		let moving = false;
		for (let i = 0; i < target.length; i++) {
			const difference = target[i] - display[i];
			if (Math.abs(difference) < 0.0001) display[i] = target[i];
			else {
				display[i] += difference * amount;
				moving = true;
			}
		}
		return moving;
	}

	function playBattleReplay() {
		if (!level) return;
		unlockAudio();
		if (replayPlaying || prefersReducedMotion.current) {
			startBattleReplay();
			return;
		}
		const totalSamples = Math.max(samples.length, opponentSamples.length);
		if (!totalSamples) return;
		cancelAnimationFrame(replayTimer);
		replayXs = linspace(...level.xRange, 200);
		replayIdx = totalSamples;
		updateReplayShapes();
		replayOpacity = 1;
		replayPlaying = true;
		const empty = replayXs.map(() => 0);
		let targets = replayTargets();
		let stage: 'adding' | 'settling' | 'holding' | 'fading' = 'fading';
		let stageElapsed = 0;
		let nextSampleAt = REPLAY_START_DELAY_MS;
		let lastFrameAt = performance.now();

		function restartBuild() {
			replayIdx = 0;
			yourReplayKde = [...empty];
			oppReplayKde = [...empty];
			targets = { you: [...empty], opponent: [...empty] };
			replayOpacity = 1;
			stage = 'adding';
			stageElapsed = 0;
			nextSampleAt = REPLAY_START_DELAY_MS;
		}

		function frame(now: number) {
			if (phase !== 'ended' || !replayPlaying) return;
			if (prefersReducedMotion.current) {
				startBattleReplay();
				return;
			}
			// Advance only through visible animation time; a hidden tab must not skip the build.
			const delta = document.hidden ? 0 : Math.min(64, Math.max(0, now - lastFrameAt));
			lastFrameAt = now;
			stageElapsed += delta;
			if (stage === 'adding' && stageElapsed >= nextSampleAt) {
				replayIdx = Math.min(totalSamples, replayIdx + 1);
				targets = replayTargets();
				nextSampleAt += REPLAY_STEP_MS;
				if (replayIdx === totalSamples) stage = 'settling';
			}

			const amount = 1 - Math.exp(-delta / (stage === 'fading' ? 68 : REPLAY_EASE_MS));
			const yourMoving = easeReplayShape(
				yourReplayKde,
				stage === 'fading' ? empty : targets.you,
				amount
			);
			const opponentMoving = easeReplayShape(
				oppReplayKde,
				stage === 'fading' ? empty : targets.opponent,
				amount
			);

			if (stage === 'settling' && !yourMoving && !opponentMoving) {
				stage = 'holding';
				stageElapsed = 0;
			} else if (stage === 'holding' && stageElapsed >= REPLAY_HOLD_MS) {
				stage = 'fading';
				stageElapsed = 0;
			} else if (stage === 'fading') {
				replayOpacity = Math.max(0, 1 - stageElapsed / REPLAY_FADE_MS);
				if (stageElapsed >= REPLAY_FADE_MS) restartBuild();
			}
			drawBattleReplay();
			replayTimer = requestAnimationFrame(frame);
		}
		replayTimer = requestAnimationFrame(frame);
	}

	function drawBattleReplay() {
		if (!replayCanvas || !level || !replayXs.length) return;
		const ctx = replayCanvas.getContext('2d');
		if (!ctx) return;
		const w = replayCanvas.clientWidth;
		const h = replayCanvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		replayCanvas.width = Math.round(w * dpr);
		replayCanvas.height = Math.round(h * dpr);
		ctx.scale(dpr, dpr);
		const styles = getComputedStyle(document.documentElement);
		const color = (name: string) => styles.getPropertyValue(name).trim();
		ctx.fillStyle = color('--canvas-bg');
		ctx.fillRect(0, 0, w, h);
		const pad = 24;
		const pw = w - pad * 2;
		const ph = h - pad * 2;
		const [xMin, xMax] = level.xRange;
		const pdfVals = normalizeShape(replayXs.map((x) => level!.pdf(x)));
		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (value: number) => pad + ph - value * ph * 0.9;
		const baseY = toY(0);
		ctx.strokeStyle = color('--canvas-axis');
		ctx.lineWidth = 1;
		for (let i = 0; i <= 4; i++) {
			const y = toY(i / 4);
			ctx.beginPath();
			ctx.moveTo(pad, y);
			ctx.lineTo(w - pad, y);
			ctx.stroke();
		}
		const drawShape = (
			values: number[],
			stroke: string,
			dashed: boolean,
			fill: boolean,
			dotted = false
		) => {
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const x = toX(replayXs[i]);
				const y = toY(values[i] ?? 0);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = stroke;
			ctx.lineWidth = dashed ? 2.5 : 2;
			ctx.setLineDash(dashed ? [7, 5] : dotted ? [2, 5] : []);
			ctx.lineCap = dotted ? 'round' : 'butt';
			ctx.stroke();
			ctx.setLineDash([]);
			if (fill) {
				ctx.lineTo(toX(xMax), baseY);
				ctx.lineTo(toX(xMin), baseY);
				ctx.closePath();
				ctx.globalAlpha = 0.06;
				ctx.fillStyle = stroke;
				ctx.fill();
				ctx.globalAlpha = 1;
			}
		};
		drawShape(pdfVals, color('--accent-cyan'), false, true);
		ctx.globalAlpha = replayOpacity;
		if (showYou && replayIdx > 0 && samples.length) {
			drawShape(yourReplayKde, color('--accent-orange'), true, false);
			ctx.fillStyle = color('--accent-orange');
			for (const sample of samples.slice(0, replayIdx)) {
				ctx.beginPath();
				ctx.arc(toX(sample), baseY, 3, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		if (showOpponent && replayIdx > 0 && opponentSamples.length) {
			drawShape(oppReplayKde, color('--accent-purple'), false, false, true);
			ctx.fillStyle = color('--accent-purple');
			for (const sample of opponentSamples.slice(0, replayIdx)) {
				ctx.beginPath();
				ctx.arc(toX(sample), baseY - 8, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.globalAlpha = 1;
	}

	function handleSampleAdd(x: number) {
		if (phase !== 'playing' || !level || timeLeftMs <= 0 || samples.length >= 200) return;
		if (socket?.socket.readyState !== WebSocket.OPEN) return;
		if (!Number.isFinite(x) || x < level.xRange[0] || x > level.xRange[1]) return;
		const now = Date.now();
		if (now - lastAcceptedSampleAt < 50) return;
		lastAcceptedSampleAt = now;
		unlockAudio();
		playSample((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0]));
		samples = [...samples, x];
		socket?.addSample(x);

		// Recalc local score
		const elapsed = Date.now() - startTime;
		scoreResult = { ...getFullScore(samples, level, elapsed), clicks: samples.length };
	}

	afterNavigate(() => initializeBattle(battleId));
	beforeNavigate(() => {
		persistBattleResult();
	});
	onMount(() => {
		mounted = true;
		const unsubscribe = session.subscribe(() => queueMicrotask(maybeSyncSession));
		return () => {
			mounted = false;
			unsubscribe();
			persistBattleResult();
			clearTimeout(connTimeout);
			stopCountdownTimer();
			cancelAnimationFrame(replayTimer);
			socket?.close();
		};
	});

	function initializeBattle(nextBattle: string) {
		if (activeBattle === nextBattle) return;
		persistBattleResult();
		socket?.close();
		socket = null;
		stopCountdownTimer();
		cancelAnimationFrame(replayTimer);
		clearTimeout(connTimeout);
		activeBattle = nextBattle;
		const saved = readPendingBattle(nextBattle);
		completedResult = saved?.result ?? null;
		connectedPlayerId = saved?.playerId ?? '';
		battleSeed = saved?.seed ?? 0;
		battleDifficulty = saved?.targetDifficulty ?? 0;
		level = saved ? reconstructLevel(saved.seed, saved.targetDifficulty) : null;
		samples = saved?.samples ?? [];
		opponentSamples = saved?.result.opponentSamples ?? [];
		opponentName = saved?.opponentName ?? 'Opponent';
		opponentElo = saved?.opponentElo ?? 1200;
		opponentCountry = saved?.opponentCountry ?? null;
		durationMs = saved?.durationMs ?? 20000;
		timeLeftMs = saved ? 0 : durationMs;
		showYou = saved?.showYou ?? true;
		showOpponent = saved?.showOpponent ?? true;
		compareOpponent = true;
		opponentKde = [];
		opponentMatchPct = 0;
		isJackpot = saved?.isJackpot ?? false;
		jackpotMatchPct = saved?.jackpotMatchPct ?? 0;
		won = saved?.result.won ?? false;
		winnerId = saved?.result.winnerId ?? '';
		winnerName = saved?.result.winnerName ?? '';
		yourScore = saved?.result.yourScore ?? 0;
		yourMatchPct_result = saved?.result.yourMatchPct ?? 0;
		opponentScore = saved?.result.opponentScore ?? 0;
		opponentMatchPct_result = saved?.result.opponentMatchPct ?? 0;
		yourEloDelta = saved?.result.yourEloDelta ?? 0;
		pendingReport = saved?.pendingReport ?? false;
		requestSent = saved?.requestSent ?? false;
		isReporting = false;
		reportSaved = false;
		reportedNewElo = null;
		battleTierName = null;
		battleTierColor = null;
		battleRankUp = false;
		reportError = requestSent
			? 'Your battle result has not been confirmed. Retry saving to check it.'
			: '';
		signInError = page.url.searchParams.has('error')
			? 'Sign-in was cancelled or failed. Your battle result is preserved. Try again.'
			: '';
		phase = saved ? 'ended' : 'connecting';
		if (saved) startBattleReplay();
		else
			connTimeout = setTimeout(() => {
				if (phase === 'connecting') phase = 'expired';
			}, 8000);
		queueMicrotask(maybeSyncSession);
	}

	function maybeSyncSession() {
		if (!mounted || $session.isPending) return;
		if (phase === 'ended') {
			if (pendingReport && !isAnonymous) void reportBattleResult();
			return;
		}
		if (phase !== 'connecting' || socket || !activeBattle) return;
		const connectingBattle = activeBattle;
		connectedPlayerId = myPlayerId;
		socket = joinBattle(
			connectingBattle,
			connectedPlayerId,
			myName,
			1200,
			null,
			(msg) => {
				if (activeBattle === connectingBattle) handleMessage(msg);
			},
			(err) => console.error('Battle connection error:', err)
		);
	}
</script>

<svelte:window
	bind:innerWidth={viewportWidth}
	onmacmacbeforesignin={handleBeforeSignIn}
	onmacmacsigninfailed={handleSignInFailed}
	onpagehide={() => {
		persistBattleResult();
	}}
	onbeforeunload={() => {
		persistBattleResult();
	}}
/>

<svelte:head>
	<title>Duel — macmac</title>
</svelte:head>

<div class="battle-shell" class:live={phase === 'playing'}>
	<AppHeader />

	{#if phase === 'connecting' || phase === 'waiting'}
		<main class="battle-stage">
			<div class="duel-symbol" aria-hidden="true"><Swords size={32} strokeWidth={1.5} /></div>
			<h1>Your next duel</h1>
			<p class="stage-description">Same target. Two players. Best final score wins.</p>
			<div class="connection-status" role="status">
				<span class="status-dot"></span>
				{phase === 'connecting' ? 'Connecting to the arena…' : 'Waiting for the other player…'}
			</div>
			<div class="duel-guide">
				<span class="guide-shape target-shape" aria-hidden="true"></span>
				<p>
					Match the <strong class="target-text">cyan target</strong> by placing samples anywhere in
					the graph. Your shape is <strong class="you-text">orange</strong>.
				</p>
			</div>
			<button
				onclick={() => {
					socket?.close();
					goto(resolve('/'));
				}}
				class="quiet-button"
			>
				<ArrowLeft size={15} /> Leave duel
			</button>
		</main>
	{:else if phase === 'countdown'}
		<main class="battle-stage countdown-stage">
			<div class="countdown-matchup">
				<div><strong>{myName}</strong><span>Your orange shape</span></div>
				<Swords size={24} aria-hidden="true" />
				<div><strong>Opponent</strong><span>Their violet shape</span></div>
			</div>
			<p class="countdown-ready">Same target. Best final score wins.</p>
			<h1>Make your shape.</h1>
			<div
				class="countdown-number"
				role="status"
				aria-label={`Starting in ${countdownNum} ${countdownNum === 1 ? 'second' : 'seconds'}`}
			>
				{countdownNum}
			</div>
			<p class="stage-description">Click or tap the graph to match the cyan target.</p>
			<p class="stage-note">
				Watch your opponent’s shape in purple. Hide it any time to focus on yours.
			</p>
		</main>
	{:else if phase === 'playing' && level}
		<main class="duel-play">
			<div class="duel-scoreboard">
				<div class="player-meter your-meter">
					<div class="player-label">
						<span class="player-dot"></span><span class="player-name" title={myName}>{myName}</span
						><span class="player-role">You</span>
					</div>
					<div class="match-value">
						<strong>{scoreResult.matchPct}<span>%</span></strong>
						<div class="player-detail">
							<span>Shape match</span><span class="sample-count"
								>{samples.length} {samples.length === 1 ? 'sample' : 'samples'}</span
							>
						</div>
					</div>
					<div class="match-track"><div style:width={`${scoreResult.matchPct}%`}></div></div>
				</div>
				<div
					class="duel-clock"
					class:critical={battleTimerCritical}
					style:--clock-color={battleTimerColor}
					role="timer"
					aria-label="Time remaining in duel"
				>
					<svg class="clock-ring" viewBox="0 0 120 120" aria-hidden="true"
						><circle class="clock-ring-track" cx="60" cy="60" r="54" /><circle
							class="clock-ring-progress"
							cx="60"
							cy="60"
							r="54"
							stroke-dasharray={2 * Math.PI * 54}
							stroke-dashoffset={2 * Math.PI * 54 * (1 - battleTimerPct)}
						/></svg
					>
					<strong>{timerDisplay}</strong>
				</div>
				<div class="player-meter opponent-meter">
					<div class="player-label">
						<span class="player-dot"></span><span class="player-name" title={opponentName}
							>{#if opponentCountry}{countryFlag(opponentCountry)}
							{/if}{opponentName}</span
						><span class="player-role">{opponentElo} ELO</span>
					</div>
					<div class="match-value">
						<strong>{opponentMatchPct}<span>%</span></strong>
						<div class="player-detail">
							<span>Shape match</span><span class="sample-count">Opponent</span>
						</div>
					</div>
					<div class="match-track"><div style:width={`${opponentMatchPct}%`}></div></div>
				</div>
			</div>
			<div class="duel-toolbar">
				<p class="duel-standing" class:leading={matchGap > 0} class:trailing={matchGap < 0}>
					{battleStanding}
				</p>
				<button
					class="compare-button"
					class:active={compareOpponent}
					aria-pressed={compareOpponent}
					onclick={() => {
						unlockAudio();
						compareOpponent = !compareOpponent;
					}}
				>
					{#if compareOpponent}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
					{compareOpponent ? 'Hide opponent' : 'Compare opponent'}
				</button>
			</div>
			<div class="duel-canvas">
				<GameCanvas
					{level}
					{samples}
					onSampleAdd={handleSampleAdd}
					{opponentKde}
					showOpponent={compareOpponent}
					opponentLabel={opponentName}
					disabled={timeLeftMs <= 0 || samples.length >= 200}
				/>
			</div>
			<div class="duel-footer">
				<p>
					<span class="target-text">Cyan</span> is the target. <span class="you-text">Orange</span> is
					yours. Tap anywhere in the graph.
				</p>
				<span class="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> aim <kbd>Space</kbd> place</span>
			</div>
		</main>
	{:else if phase === 'ended'}
		<main class="result-page">
			<div class="result-heading">
				<div>
					{#if isJackpot}<p class="jackpot-label">
							Jackpot! {winnerName} hit {jackpotMatchPct}%
						</p>{/if}
					<h1 class:won={isWinner}>
						<span class="result-icon" aria-hidden="true"
							>{#if isWinner}<Trophy strokeWidth={1.7} />{:else}<Swords
									strokeWidth={1.7}
								/>{/if}</span
						><span class="result-title"
							>{isWinner ? 'You won the duel.' : 'Opponent won this duel.'}</span
						>
					</h1>
					<p>
						{scoreMargin === 0
							? 'Both players finished with the same score.'
							: `${scoreMargin.toLocaleString()} ${scoreMargin === 1 ? 'point' : 'points'} ${isWinner ? 'ahead of' : 'behind'} ${opponentName}.`}
					</p>
				</div>
			</div>
			<div class="result-layout">
				<section class="replay-panel" aria-label="Compare final shapes">
					<div class="result-statistics">
						<div class="result-player your-result">
							<div class="result-player-name">
								<span class="player-dot"></span> You {#if isWinner}<span class="winner-mark"
										>Winner</span
									>{/if}
							</div>
							<strong
								>{yourScore.toLocaleString()}<span>{yourScore === 1 ? 'point' : 'points'}</span
								></strong
							>
							<p>
								<b>{yourMatchPct_result}%</b> match
								<span>{samples.length} {samples.length === 1 ? 'sample' : 'samples'}</span>
							</p>
							<div class="match-track"><div style:width={`${yourMatchPct_result}%`}></div></div>
						</div>
						<div class="result-player opponent-result">
							<div class="result-player-name" title={opponentName}>
								<span class="player-dot"></span>{opponentName}
								{#if !isWinner}<span class="winner-mark">Winner</span>{/if}
							</div>
							<strong
								>{opponentScore.toLocaleString()}<span
									>{opponentScore === 1 ? 'point' : 'points'}</span
								></strong
							>
							<p>
								<b>{opponentMatchPct_result}%</b> match
								<span
									>{opponentSamples.length}
									{opponentSamples.length === 1 ? 'sample' : 'samples'}</span
								>
							</p>
							<div class="match-track"><div style:width={`${opponentMatchPct_result}%`}></div></div>
						</div>
					</div>
					<div class="replay-heading desktop-replay">
						<h2>The final shapes</h2>
						<button
							class="quiet-button"
							onclick={playBattleReplay}
							disabled={!samples.length && !opponentSamples.length}
							>{#if replayPlaying}<RotateCcw size={14} /> Show final{:else}<Play size={14} /> Watch build{/if}</button
						>
					</div>
					<canvas
						{@attach attachReplayCanvas}
						class="result-canvas"
						aria-label={`Your final shape matched the target ${yourMatchPct_result} percent. ${opponentName} matched ${opponentMatchPct_result} percent.`}
					></canvas>
					<div class="replay-controls">
						<span class="target-legend"><span></span> Target</span>
						<button
							class="replay-toggle you-toggle"
							class:active={showYou}
							aria-pressed={showYou}
							aria-label="Your shape"
							onclick={() => toggleReplay('you')}
							><span class="toggle-line"></span><span class="desktop-toggle-text">Your shape</span
							><span class="mobile-toggle-text">You</span></button
						>
						<button
							class="replay-toggle opponent-toggle"
							class:active={showOpponent}
							aria-pressed={showOpponent}
							aria-label={showOpponent ? 'Hide opponent' : 'Compare opponent'}
							onclick={() => toggleReplay('opponent')}
							><span class="toggle-line"></span><span class="desktop-toggle-text"
								>{showOpponent ? 'Hide opponent' : 'Compare opponent'}</span
							><span class="mobile-toggle-text">Opponent</span></button
						>
						<button
							class="quiet-button mobile-replay"
							onclick={playBattleReplay}
							disabled={!samples.length && !opponentSamples.length}
							aria-label={replayPlaying ? 'Show final' : 'Watch build'}
							>{#if replayPlaying}<RotateCcw size={14} /> Final{:else}<Play size={14} /> Replay{/if}</button
						>
					</div>
					<p class="replay-note">
						Each curve is scaled to the same height, so you can compare its shape.
					</p>
				</section>
				<div class="result-actions">
					<a href={resolve('/?battle')} class="next-duel"><Swords size={16} /> Next duel</a>
					<a href={resolve('/')} class="quiet-button"><ArrowLeft size={14} /> Back home</a>
				</div>
				<section class="result-details" aria-label="Ranking and saving">
					<details
						class="ranking-disclosure"
						open={viewportWidth > 760 || rankingExpanded || !!reportError || !!signInError}
						ontoggle={handleRankingToggle}
					>
						<summary
							><span>Ranking &amp; save result</span><span class="ranking-summary-state"
								>{isReporting ? 'Saving…' : reportSaved ? 'Saved' : 'Details'}</span
							><span aria-hidden="true">⌄</span></summary
						>
						<div class="ranking-content">
							<div class="ranking-panel">
								<h2>{isAnonymous ? 'Your potential rank' : 'Your battle rank'}</h2>
								{#if battleRankUp && battleTierName}<p
										class="rank-up"
										style:color={battleTierColor}
									>
										Rank up! {battleTierName}
									</p>{/if}
								{#if reportedNewElo !== null || isAnonymous}
									{@const displayElo = reportedNewElo ?? anonElo}
									{@const tier = getBattleTier(displayElo)}
									{@const progress = getBattleTierProgress(displayElo)}
									<div class="rank-current">
										<RankBadge mode="battle" value={displayElo} size="lg" />
										<div>
											<strong style:color={tier.color}>{displayElo}</strong><span>{tier.name}</span>
										</div>
									</div>
									<div class="rank-progress" style:--tier-color={tier.color}>
										<div style:width={`${progress * 100}%`}></div>
									</div>
								{/if}
								<div class="rank-delta">
									<span>Ranking change</span><strong
										class:positive={yourEloDelta >= 0}
										class:negative={yourEloDelta < 0}
										>{yourEloDelta >= 0 ? '+' : ''}{yourEloDelta}</strong
									>
								</div>
							</div>
							{#if signInError || reportError}
								<p
									role="alert"
									class="mb-3 text-center text-xs"
									style="color: var(--accent-orange);"
								>
									{signInError || reportError}
								</p>
							{/if}
							{#if isReporting}
								<p
									role="status"
									class="mb-3 text-center text-xs"
									style="color: var(--text-secondary);"
								>
									Saving battle result…
								</p>
							{:else if reportSaved}
								<p role="status" class="mb-3 text-center text-xs" style="color: var(--win-green);">
									Battle result saved!
								</p>
							{:else if !isAnonymous && completedResult?.resultToken}
								<button
									onclick={reportBattleResult}
									class="btn-action mb-3 w-full"
									style="--btn-color: var(--accent-cyan);"
									><span class="btn-action-face w-full justify-center"
										>{reportError ? 'Retry saving' : 'Save battle result'}</span
									></button
								>
							{/if}

							<!-- Sign-in prompt for anonymous users -->
							{#if isAnonymous}
								<div
									class="mb-3 text-center text-xs font-medium"
									style="color: var(--text-tertiary);"
								>
									{completedResult?.resultToken
										? 'Sign in to save this result and ranking. Your replay will be preserved.'
										: 'Sign in for your next battle. This replay is preserved; its ranking cannot be claimed.'}
								</div>
								<div class="mb-4 flex flex-col gap-2">
									<button
										onclick={() => signInWith('github')}
										disabled={isSigningIn || $session.isPending}
										class="result-auth"
									>
										<Github size={14} /> Continue with GitHub
									</button>
									<button
										onclick={() => signInWith('google')}
										disabled={isSigningIn || $session.isPending}
										class="result-auth"
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
							{/if}
						</div>
					</details>
				</section>
			</div>
		</main>
	{:else if phase === 'expired'}
		<main class="battle-stage">
			<div class="duel-symbol" aria-hidden="true"><Swords size={30} /></div>
			<h1>This duel is over.</h1>
			<p class="stage-description">The arena is no longer available. A new opponent awaits.</p>
			<a href={resolve('/?battle')} class="btn-action" style="--btn-color: var(--accent-red);"
				><span class="btn-action-face"><Swords size={16} /> Find a duel</span></a
			>
			<a href={resolve('/')} class="quiet-button"><ArrowLeft size={14} /> Back home</a>
		</main>
	{/if}
</div>

<style>
	.battle-shell {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		font-family: var(--font-body);
	}
	.battle-shell.live {
		height: 100dvh;
		min-height: 0;
		overflow: hidden;
	}
	.battle-stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 40px 24px 64px;
		gap: 18px;
	}
	h1 {
		font-family: var(--font-display);
		font-weight: 600;
		letter-spacing: -0.055em;
		color: var(--text-primary);
	}
	.battle-stage h1 {
		font-size: clamp(36px, 5vw, 60px);
		line-height: 1.12;
	}
	.duel-symbol {
		width: 68px;
		height: 68px;
		display: grid;
		place-items: center;
		color: var(--accent-purple);
		border-radius: 14px;
		background: transparent;
		margin-bottom: 4px;
	}
	.stage-description {
		color: var(--text-secondary);
		font-size: 15px;
		max-width: 460px;
		line-height: 1.7;
	}
	.stage-note {
		color: var(--text-secondary);
		font-size: 12px;
		max-width: 380px;
		line-height: 1.6;
	}
	.connection-status {
		display: flex;
		align-items: center;
		gap: 9px;
		color: var(--text-primary);
		font-size: 13px;
		margin: 10px 0;
	}
	.status-dot {
		height: 6px;
		width: 6px;
		background: var(--accent-cyan);
		border-radius: 50%;
		animation: waiting-pulse 1.5s ease-in-out infinite;
	}
	.duel-guide {
		display: flex;
		align-items: center;
		gap: 18px;
		max-width: 380px;
		text-align: left;
		padding: 12px 0;
		border-radius: 10px;
		margin-bottom: 8px;
		background: transparent;
	}
	.duel-guide p {
		font-size: 12px;
		line-height: 1.7;
		color: var(--text-secondary);
	}
	.guide-shape {
		height: 26px;
		width: 48px;
		flex-shrink: 0;
		border: 2px solid var(--accent-cyan);
		border-radius: 50% 50% 0 0 / 100% 100% 0 0;
		border-bottom: 0;
	}
	.target-text {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.you-text {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.quiet-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		font-size: 12px;
		font-weight: 550;
		color: var(--text-secondary);
		padding: 9px 12px;
		border-radius: 8px;
		cursor: pointer;
		min-height: 40px;
	}
	.quiet-button:hover {
		color: var(--text-primary);
		background: var(--surface);
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid var(--accent-cyan);
		outline-offset: 4px;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.countdown-matchup {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 32px minmax(0, 1fr);
		align-items: center;
		gap: 24px;
		width: min(100%, 460px);
		padding: 18px 22px;
		margin-bottom: 8px;
	}
	.countdown-matchup > div {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.countdown-matchup strong {
		color: var(--accent-orange);
		font-family: var(--font-display);
		font-size: 15px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.countdown-matchup > div:last-child strong {
		color: var(--accent-purple);
	}
	.countdown-matchup span {
		color: var(--text-secondary);
		font-size: 11px;
	}
	.countdown-matchup :global(svg) {
		color: var(--text-secondary);
	}
	.countdown-ready {
		color: var(--text-secondary);
		font-size: 12px;
	}
	.countdown-number {
		font-family: var(--font-display);
		font-size: clamp(120px, 22vw, 220px);
		font-weight: 600;
		color: var(--accent-cyan);
		line-height: 0.9;
		margin: 14px 0;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.08em;
	}
	.duel-play {
		min-height: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 16px 24px 14px;
		width: 100%;
		max-width: 1480px;
		margin: 0 auto;
	}
	.duel-scoreboard {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 132px minmax(0, 1fr);
		gap: clamp(20px, 4vw, 60px);
		align-items: center;
		padding: 0 20px 21px;
	}
	.player-meter {
		--player-color: var(--accent-orange);
		min-width: 0;
	}
	.opponent-meter {
		--player-color: var(--accent-purple);
	}
	.player-label {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.player-dot {
		display: inline-block;
		height: 8px;
		width: 8px;
		border-radius: 2px;
		background: var(--player-color);
		flex-shrink: 0;
	}
	.player-name {
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.player-role {
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 600;
		margin-left: auto;
		flex-shrink: 0;
		padding: 3px 0;
		border-radius: 4px;
	}
	.match-value {
		display: flex;
		align-items: center;
		gap: 18px;
		margin-top: 8px;
	}
	.match-value strong {
		font-family: var(--font-display);
		font-size: clamp(36px, 4.5vw, 56px);
		font-weight: 600;
		line-height: 1;
		color: var(--player-color);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.055em;
	}
	.match-value strong span {
		font-size: 0.43em;
		margin-left: 3px;
		letter-spacing: -0.02em;
	}
	.player-detail {
		display: flex;
		flex-direction: column;
		gap: 4px;
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.3;
	}
	.sample-count {
		color: var(--text-tertiary);
		font-size: 10px;
	}
	.match-track {
		height: 6px;
		margin-top: 14px;
		border-radius: 2px;
		overflow: hidden;
		background: color-mix(in srgb, var(--player-color) 12%, var(--surface));
	}
	.match-track > div {
		height: 100%;
		background: var(--player-color);
		transition: width 180ms ease-out;
		border-radius: inherit;
	}
	.opponent-meter .player-label {
		flex-direction: row-reverse;
	}
	.opponent-meter .player-role {
		margin-left: 0;
		margin-right: auto;
	}
	.opponent-meter .match-value {
		flex-direction: row-reverse;
		text-align: right;
	}
	.opponent-meter .match-track {
		display: flex;
		justify-content: flex-end;
	}
	.duel-clock {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--clock-color);
		width: 132px;
		height: 132px;
		position: relative;
	}
	.clock-ring {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		transform: rotate(-90deg);
	}
	.clock-ring circle {
		fill: none;
		stroke-width: 2;
	}
	.clock-ring-track {
		stroke: var(--border-hover);
	}
	.clock-ring-progress {
		stroke: currentColor;
		stroke-linecap: round;
	}
	.duel-clock > :not(.clock-ring) {
		position: relative;
	}
	.duel-clock strong {
		font-family: var(--font-display);
		font-size: 44px;
		font-weight: 600;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.055em;
	}
	.duel-clock.critical strong {
		animation: clock-pulse 1s ease-in-out infinite;
	}
	.duel-toolbar {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
		padding: 8px 16px;
		flex-shrink: 0;
		border-radius: 12px 12px 0 0;
		background: var(--canvas-bg);
	}
	.duel-standing {
		font-size: 12px;
		color: var(--text-secondary);
		line-height: 1.4;
	}
	.duel-standing.leading {
		color: var(--text-secondary);
	}
	.duel-standing.trailing {
		color: var(--text-secondary);
	}
	.compare-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border-radius: 8px;
		padding: 7px 10px;
		font-size: 11px;
		font-weight: 550;
		color: var(--text-secondary);
		background: transparent;
		cursor: pointer;
		flex-shrink: 0;
		min-height: 40px;
	}
	.compare-button:hover {
		background: color-mix(in srgb, var(--accent-purple) 9%, var(--canvas-bg));
	}
	.compare-button.active {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--accent-purple) 10%, var(--canvas-bg));
	}
	.duel-canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
		border-radius: 0 0 12px 12px;
		background: var(--canvas-bg);
		padding: 0;
	}
	.duel-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		gap: 12px;
		padding: 13px 2px 0;
	}
	.duel-footer p {
		font-size: 11px;
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.keyboard-hint {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-secondary);
		font-size: 10px;
	}
	kbd {
		font: inherit;
		border-radius: 3px;
		padding: 2px 5px;
		background: var(--surface);
	}
	.result-page {
		width: 100%;
		max-width: 1220px;
		margin: 0 auto;
		padding: 28px 32px 44px;
	}
	.result-heading {
		--result-title-size: clamp(32px, 4vw, 48px);
		--result-title-gap: 12px;
		margin-bottom: 26px;
		padding-bottom: 22px;
	}
	.result-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 1em;
		width: 1em;
		height: 1em;
		margin-top: 0.075em;
	}
	.result-icon :global(svg) {
		width: 100%;
		height: 100%;
	}
	.result-title {
		min-width: 0;
	}
	.result-heading h1 {
		font-size: var(--result-title-size);
		display: flex;
		align-items: flex-start;
		gap: var(--result-title-gap);
		line-height: 1.15;
		color: var(--accent-purple);
	}
	.result-heading h1.won {
		color: var(--accent-orange);
	}
	.result-heading p {
		font-size: 13px;
		color: var(--text-secondary);
		margin-top: 8px;
		line-height: 1.5;
	}
	.result-heading p:not(.jackpot-label) {
		padding-left: calc(var(--result-title-size) + var(--result-title-gap));
	}
	.result-heading .jackpot-label {
		color: var(--accent-orange);
		font-weight: 650;
		margin: 0 0 7px;
	}
	.result-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 260px;
		grid-template-areas: 'plot details' 'plot actions';
		column-gap: 32px;
		row-gap: 12px;
		align-items: start;
	}
	.replay-panel {
		grid-area: plot;
		min-width: 0;
	}
	h2 {
		color: var(--text-primary);
		font-family: var(--font-display);
		font-size: 13px;
		font-weight: 550;
		letter-spacing: -0.02em;
	}
	.result-statistics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 32px;
		margin: 0 0 22px;
	}
	.result-player {
		--player-color: var(--accent-orange);
		min-width: 0;
	}
	.opponent-result {
		--player-color: var(--accent-purple);
		padding-left: 0;
	}
	.result-player-name {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--text-secondary);
		font-size: 12px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.winner-mark {
		font-size: 9px;
		color: var(--text-primary);
		margin-left: auto;
		border-radius: 4px;
		padding: 2px 0;
		font-weight: 650;
	}
	.result-player > strong {
		color: var(--player-color);
		font-family: var(--font-display);
		font-size: clamp(30px, 4vw, 44px);
		line-height: 1.5;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.05em;
	}
	.result-player > strong span {
		color: var(--text-secondary);
		font-family: var(--font-body);
		font-size: 10px;
		font-weight: 450;
		letter-spacing: 0;
		margin-left: 7px;
	}
	.result-player p {
		color: var(--text-secondary);
		font-size: 11px;
	}
	.result-player p b {
		font-weight: 650;
		color: var(--text-primary);
	}
	.result-player p span {
		margin-left: 12px;
	}
	.result-player .match-track {
		margin-top: 11px;
		height: 4px;
	}
	.replay-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 14px;
		border-radius: 10px 10px 0 0;
		background: var(--canvas-bg);
	}
	.replay-heading .quiet-button {
		font-size: 11px;
		padding: 6px 8px;
	}
	.result-canvas {
		display: block;
		width: 100%;
		height: clamp(260px, 34vh, 360px);
		border-radius: 0 0 10px 10px;
		background: var(--canvas-bg);
	}
	.replay-controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
		padding-top: 12px;
	}
	.target-legend {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-secondary);
		font-size: 11px;
		padding: 7px 8px 7px 0;
	}
	.target-legend > span {
		height: 2px;
		width: 15px;
		background: var(--accent-cyan);
	}
	.replay-toggle {
		--toggle-color: var(--accent-orange);
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 10px;
		border-radius: 8px;
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
		min-height: 40px;
		background: transparent;
	}
	.replay-toggle > .toggle-line {
		width: 14px;
		height: 2px;
		background: var(--toggle-color);
		opacity: 0.35;
	}
	.you-toggle > .toggle-line {
		background: none;
		border-top: 2px dashed var(--toggle-color);
	}
	.opponent-toggle {
		--toggle-color: var(--accent-purple);
	}
	.opponent-toggle > .toggle-line {
		background: none;
		border-top: 2px dotted var(--toggle-color);
	}
	.replay-toggle.active {
		color: var(--text-primary);
		background: color-mix(in srgb, var(--toggle-color) 9%, var(--bg));
	}
	.replay-toggle.active > .toggle-line {
		opacity: 1;
	}
	.replay-note {
		font-size: 10px;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin-top: 9px;
	}
	.result-details {
		grid-area: details;
		padding-left: 0;
	}
	.ranking-panel {
		margin-bottom: 24px;
	}
	.rank-current {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 19px 0;
	}
	.rank-current strong {
		display: block;
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 600;
		line-height: 1.15;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.035em;
	}
	.rank-current span {
		font-size: 11px;
		color: var(--text-secondary);
	}
	.rank-progress {
		height: 4px;
		border-radius: 2px;
		background: var(--surface);
		margin: 10px 0 16px;
		overflow: hidden;
	}
	.rank-progress > div {
		height: 100%;
		background: var(--tier-color);
		border-radius: inherit;
	}
	.rank-delta {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-top: 10px;
	}
	.rank-delta > span {
		color: var(--text-secondary);
		font-size: 11px;
	}
	.rank-delta strong {
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.positive {
		color: var(--win-green);
	}
	.negative {
		color: var(--loss-red);
	}
	.rank-up {
		font-size: 12px;
		margin-top: 8px;
		font-weight: 650;
	}
	.result-actions {
		grid-area: actions;
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 20px;
	}
	.next-duel {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 48px;
		padding: 12px 18px;
		border-radius: 10px;
		background: var(--accent-purple);
		color: var(--on-accent);
		font-family: var(--font-display);
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
	}
	.next-duel:hover {
		filter: brightness(1.06);
	}
	.result-auth {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 9px 14px;
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-primary);
		font-size: 12px;
		font-weight: 500;
	}
	.result-auth:hover {
		background: var(--surface-raised);
	}
	.replay-toggle:hover {
		background: var(--surface);
	}

	@keyframes waiting-pulse {
		50% {
			opacity: 0.35;
		}
	}
	@keyframes clock-pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (max-width: 760px) {
		.duel-play {
			padding: 6px 16px max(14px, env(safe-area-inset-bottom));
		}
		.duel-scoreboard {
			grid-template-columns: minmax(0, 1fr) 84px minmax(0, 1fr);
			gap: 14px;
			padding: 0 2px 14px;
		}
		.player-name {
			font-size: 12px;
		}
		.player-role {
			display: none;
		}
		.player-label {
			gap: 5px;
		}
		.match-value {
			gap: 8px;
			margin-top: 7px;
		}
		.match-value strong {
			font-size: 38px;
		}
		.player-detail {
			font-size: 9px;
			gap: 3px;
		}
		.sample-count {
			font-size: 9px;
		}
		.match-track {
			margin-top: 10px;
			height: 4px;
		}
		.duel-clock {
			width: 84px;
			height: 84px;
			justify-self: center;
		}
		.duel-clock strong {
			font-size: 29px;
		}
		.duel-standing {
			font-size: 10px;
		}
		.compare-button {
			font-size: 10px;
			padding: 7px 8px;
			gap: 5px;
		}
		.duel-toolbar {
			padding: 5px 12px;
			gap: 8px;
		}
		.duel-canvas {
			padding: 0;
		}
		.keyboard-hint {
			display: none;
		}
		.duel-footer {
			padding-top: 10px;
		}
		.duel-footer p {
			font-size: 10px;
		}
		.result-page {
			padding: 18px 20px max(32px, env(safe-area-inset-bottom));
		}
		.result-heading {
			--result-title-size: 34px;
			--result-title-gap: 10px;
			margin-bottom: 22px;
			padding-bottom: 19px;
		}
		.result-heading p {
			font-size: 11px;
		}
		.result-layout {
			grid-template-columns: 1fr;
			gap: 26px;
		}
		.result-details {
			padding: 22px 0 0;
			border-left: 0;
		}
		.ranking-panel {
			max-width: 400px;
		}
		.result-canvas {
			height: 240px;
		}
		.result-player > strong {
			font-size: 32px;
		}
		.result-statistics {
			gap: 20px;
			margin-bottom: 20px;
		}
		.opponent-result {
			padding-left: 0;
		}
		.countdown-matchup {
			gap: 14px;
			padding-inline: 10px;
		}
	}
	@media (max-width: 450px) {
		.duel-scoreboard {
			grid-template-columns: minmax(0, 1fr) 68px minmax(0, 1fr);
			gap: 10px;
		}
		.match-value {
			align-items: flex-start;
			flex-direction: column;
			gap: 5px;
		}
		.opponent-meter .match-value {
			flex-direction: column;
			align-items: flex-end;
		}
		.match-value strong {
			font-size: 34px;
		}
		.player-detail {
			gap: 2px;
		}
		.duel-clock {
			width: 68px;
			height: 68px;
			justify-self: center;
		}
		.duel-clock strong {
			font-size: 25px;
		}
		.result-heading {
			--result-title-size: 29px;
		}
		.result-player > strong {
			font-size: 28px;
		}
		.result-player > strong span {
			font-size: 9px;
			margin-left: 4px;
		}
		.result-player p span {
			display: block;
			margin: 5px 0 0;
		}
		.winner-mark {
			font-size: 8px;
			padding: 2px 0;
		}
	}
	@media (max-height: 550px) and (orientation: landscape) {
		.duel-play {
			padding-top: 4px;
		}
		.duel-scoreboard {
			padding-bottom: 10px;
		}
		.match-value strong {
			font-size: 28px;
		}
		.match-value {
			margin-top: 5px;
		}
		.player-detail,
		.match-track,
		.duel-footer {
			display: none;
		}
		.duel-clock {
			width: 66px;
			height: 66px;
			justify-self: center;
		}
		.duel-clock strong {
			font-size: 25px;
		}
		.duel-toolbar {
			padding-block: 5px;
		}
	}
	.mobile-replay,
	.mobile-toggle-text {
		display: none;
	}
	.ranking-disclosure > summary {
		display: none;
	}
	.ranking-summary-state {
		margin-left: auto;
		color: var(--text-secondary);
		font-size: 11px;
	}
	.ranking-content {
		padding-top: 0;
	}
	@media (max-width: 760px) {
		.result-page {
			padding: 12px 20px max(16px, env(safe-area-inset-bottom));
		}
		.result-heading {
			--result-title-size: 27px;
			--result-title-gap: 9px;
			margin-bottom: 10px;
			padding-bottom: 0;
		}
		.result-heading p {
			font-size: 12px;
			line-height: 1.35;
			margin-top: 6px;
		}
		.result-layout {
			grid-template-areas: 'plot' 'actions' 'details';
			grid-template-columns: 1fr;
			row-gap: 12px;
		}
		.result-statistics {
			gap: 20px;
			margin-bottom: 12px;
		}
		.result-player-name {
			font-size: 12px;
			line-height: 1.2;
		}
		.result-player > strong {
			font-size: 30px;
			line-height: 1.25;
		}
		.result-player > strong span {
			display: none;
		}
		.result-player p {
			font-size: 12px;
			line-height: 1.3;
		}
		.result-player p > span {
			display: none;
		}
		.result-player .match-track {
			margin-top: 7px;
		}
		.desktop-replay,
		.desktop-toggle-text,
		.target-legend,
		.replay-note {
			display: none;
		}
		.result-canvas {
			height: clamp(160px, 27dvh, 240px);
			border-radius: 10px;
		}
		.replay-controls {
			flex-wrap: nowrap;
			gap: 6px;
			padding-top: 8px;
		}
		.replay-toggle,
		.mobile-replay {
			flex: 1 1 0;
			min-width: 0;
			min-height: 44px;
			justify-content: center;
			padding: 6px;
			font-size: 12px;
			gap: 5px;
			white-space: nowrap;
		}
		.mobile-toggle-text {
			display: inline;
		}
		.mobile-replay {
			display: inline-flex;
		}
		.result-actions {
			flex-direction: row;
			align-items: center;
			gap: 10px;
			margin-top: 0;
		}
		.result-actions > a {
			flex: 1 1 0;
			min-height: 44px;
			padding: 10px 12px;
			font-size: 12px;
		}
		.result-details {
			padding: 0;
		}
		.ranking-disclosure > summary {
			display: flex;
			align-items: center;
			gap: 8px;
			min-height: 44px;
			padding: 8px 0;
			color: var(--text-primary);
			font-size: 12px;
			cursor: pointer;
			list-style: none;
		}
		.ranking-disclosure > summary::-webkit-details-marker {
			display: none;
		}
		.ranking-content {
			padding-top: 12px;
		}
	}
	@media (max-width: 760px) and (max-height: 700px) {
		.battle-stage {
			padding: 14px 20px 24px;
			gap: 12px;
		}
		.countdown-matchup {
			padding: 10px 0;
			margin-bottom: 0;
			gap: 12px;
		}
		.countdown-ready {
			display: none;
		}
		.countdown-stage h1 {
			font-size: 30px;
		}
		.countdown-number {
			font-size: 110px;
			margin: 8px 0;
		}
		.stage-description {
			font-size: 14px;
			line-height: 1.5;
		}
		.stage-note {
			line-height: 1.5;
		}
		.duel-play {
			padding-top: 0;
		}
		.duel-scoreboard {
			padding-bottom: 8px;
		}
		.player-detail > span:first-child,
		.opponent-meter .player-detail {
			display: none;
		}
		.sample-count {
			font-size: 11px;
		}
		.duel-toolbar {
			padding-block: 2px;
		}
		.compare-button {
			min-height: 44px;
		}
		.duel-footer {
			display: none;
		}
		.result-page {
			padding: 10px 20px max(10px, env(safe-area-inset-bottom));
		}
		.result-heading {
			--result-title-size: 25px;
			margin-bottom: 8px;
		}
		.result-layout {
			row-gap: 10px;
		}
		.result-statistics {
			margin-bottom: 8px;
		}
		.result-player > strong {
			font-size: 28px;
		}
		.result-player .match-track {
			display: none;
		}
		.result-canvas {
			height: clamp(100px, 20dvh, 140px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.status-dot,
		.duel-clock.critical strong {
			animation: none;
		}
		.match-track > div {
			transition: none;
		}
	}
</style>
