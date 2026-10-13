<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { reconstructLevel } from '$lib/game/generator';
	import { getFullScore, type ScoreResult } from '$lib/game/scoring';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
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
	import {
		Github,
		Swords,
		Eye,
		EyeOff,
		Play,
		Trophy,
		ArrowLeft,
		RotateCcw,
		Timer
	} from 'lucide-svelte';
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

	function updateReplayShapes() {
		const yourSlice = samples.slice(0, Math.min(replayIdx, samples.length));
		const opponentSlice = opponentSamples.slice(0, Math.min(replayIdx, opponentSamples.length));
		yourReplayKde = yourSlice.length ? computeKDE(yourSlice, replayXs) : replayXs.map(() => 0);
		oppReplayKde = opponentSlice.length
			? computeKDE(opponentSlice, replayXs)
			: replayXs.map(() => 0);
	}

	function startBattleReplay() {
		if (!level) return;
		cancelAnimationFrame(replayTimer);
		replayPlaying = false;
		replayXs = linspace(...level.xRange, 200);
		replayIdx = Math.max(samples.length, opponentSamples.length);
		updateReplayShapes();
		drawBattleReplay();
	}

	function playBattleReplay() {
		if (!level) return;
		unlockAudio();
		cancelAnimationFrame(replayTimer);
		if (replayPlaying) {
			startBattleReplay();
			return;
		}
		const totalSamples = Math.max(samples.length, opponentSamples.length);
		if (!totalSamples) return;
		replayPlaying = true;
		const startedAt = performance.now();
		const stepDuration = Math.max(45, Math.min(180, 2400 / totalSamples));
		replayIdx = 0;
		function frame(now: number) {
			if (phase !== 'ended') return;
			replayIdx = Math.min(totalSamples, Math.floor((now - startedAt) / stepDuration));
			updateReplayShapes();
			drawBattleReplay();
			if (replayIdx < totalSamples) replayTimer = requestAnimationFrame(frame);
			else replayPlaying = false;
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
		const pdfVals = replayXs.map((x) => level!.pdf(x));
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
		const drawShape = (values: number[], stroke: string, dashed: boolean, fill: boolean) => {
			const peak = Math.max(...values) || 1;
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const x = toX(replayXs[i]);
				const y = toY((values[i] ?? 0) / peak);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = stroke;
			ctx.lineWidth = dashed ? 2.5 : 2;
			ctx.setLineDash(dashed ? [7, 5] : []);
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
			drawShape(oppReplayKde, color('--accent-purple'), false, false);
			ctx.fillStyle = color('--accent-purple');
			for (const sample of opponentSamples.slice(0, replayIdx)) {
				ctx.beginPath();
				ctx.arc(toX(sample), baseY - 8, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
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
			<p class="countdown-ready">Both players are ready</p>
			<h1>Make your shape.</h1>
			<div
				class="countdown-number"
				role="status"
				aria-label={`Starting in ${countdownNum} seconds`}
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
						<span class="player-dot"></span> Your match <span class="player-name">{myName}</span>
					</div>
					<div class="match-value">
						<strong>{scoreResult.matchPct}<span>%</span></strong><span class="sample-count"
							>{samples.length} {samples.length === 1 ? 'sample' : 'samples'}</span
						>
					</div>
					<div class="match-track"><div style:width={`${scoreResult.matchPct}%`}></div></div>
				</div>
				<div
					class="duel-clock"
					class:critical={battleTimerCritical}
					style:--clock-color={battleTimerColor}
				>
					<Timer size={15} aria-hidden="true" />
					<strong>{timerDisplay}</strong>
					<span>remaining</span>
				</div>
				<div class="player-meter opponent-meter">
					<div class="player-label">
						<span class="player-dot"></span><span class="opponent-name" title={opponentName}
							>{#if opponentCountry}{countryFlag(opponentCountry)}
							{/if}{opponentName}</span
						><span class="opponent-elo">{opponentElo} ELO</span>
					</div>
					<div class="match-value">
						<strong>{opponentMatchPct}<span>%</span></strong><span class="sample-count"
							>Opponent’s match</span
						>
					</div>
					<div class="match-track"><div style:width={`${opponentMatchPct}%`}></div></div>
				</div>
			</div>
			<div class="time-track" aria-hidden="true">
				<div style:width={`${battleTimerPct * 100}%`} style:background={battleTimerColor}></div>
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
				<div class="result-icon" class:won={isWinner} aria-hidden="true">
					{#if isWinner}<Trophy size={28} />{:else}<Swords size={28} />{/if}
				</div>
				<div>
					{#if isJackpot}<p class="jackpot-label">
							Jackpot! {winnerName} hit {jackpotMatchPct}%
						</p>{/if}
					<h1 class:won={isWinner}>{isWinner ? 'You won the duel.' : 'Opponent won this duel.'}</h1>
					<p>
						{scoreMargin === 0
							? 'Both players finished with the same score.'
							: `${scoreMargin.toLocaleString()} ${scoreMargin === 1 ? 'point' : 'points'} ${isWinner ? 'ahead of' : 'behind'} ${opponentName}.`}
					</p>
				</div>
			</div>
			<div class="result-layout">
				<section class="replay-panel" aria-label="Compare final shapes">
					<div class="replay-heading">
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
							onclick={() => toggleReplay('you')}><span></span> Your shape</button
						>
						<button
							class="replay-toggle opponent-toggle"
							class:active={showOpponent}
							aria-pressed={showOpponent}
							onclick={() => toggleReplay('opponent')}
							><span></span>{showOpponent ? 'Hide opponent' : 'Compare opponent'}</button
						>
					</div>
					<p class="replay-note">
						Each curve is scaled to the same height, so you can compare its shape.
					</p>
					<div class="result-statistics">
						<div class="result-player your-result">
							<div class="result-player-name"><span class="player-dot"></span> You</div>
							<strong
								>{yourScore.toLocaleString()}<span>{yourScore === 1 ? 'point' : 'points'}</span
								></strong
							>
							<p>
								<b>{yourMatchPct_result}%</b> match
								<span>{samples.length} {samples.length === 1 ? 'sample' : 'samples'}</span>
							</p>
						</div>
						<div class="result-player opponent-result">
							<div class="result-player-name" title={opponentName}>
								<span class="player-dot"></span>{opponentName}
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
						</div>
					</div>
				</section>
				<section class="result-details" aria-label="Ranking and next duel">
					<div class="ranking-panel">
						<h2>{isAnonymous ? 'Your potential rank' : 'Your battle rank'}</h2>
						{#if battleRankUp && battleTierName}<p class="rank-up" style:color={battleTierColor}>
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
						<p role="alert" class="mb-3 text-center text-xs" style="color: var(--accent-orange);">
							{signInError || reportError}
						</p>
					{/if}
					{#if isReporting}
						<p role="status" class="mb-3 text-center text-xs" style="color: var(--text-secondary);">
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
						<div class="mb-3 text-center text-xs font-medium" style="color: var(--text-tertiary);">
							{completedResult?.resultToken
								? 'Sign in to save this result and ranking. Your replay will be preserved.'
								: 'Sign in for your next battle. This replay is preserved; its ranking cannot be claimed.'}
						</div>
						<div class="mb-4 flex flex-col gap-2">
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
					{/if}

					<div class="result-actions">
						<a href={resolve('/?battle')} class="btn-action" style="--btn-color: var(--accent-red);"
							><span class="btn-action-face w-full justify-center"
								><Swords size={16} /> Next duel</span
							></a
						>
						<a href={resolve('/')} class="quiet-button"><ArrowLeft size={14} /> Back home</a>
					</div>
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
		padding: 36px 24px 64px;
		gap: 18px;
	}
	.duel-symbol {
		color: var(--accent-red);
		border: 1px solid color-mix(in srgb, var(--accent-red) 24%, var(--border));
		border-radius: 22px;
		display: grid;
		place-items: center;
		width: 78px;
		height: 78px;
		margin-bottom: 6px;
		transform: rotate(-7deg);
	}
	h1 {
		font-family: 'Outfit', sans-serif;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text-primary);
	}
	.battle-stage h1 {
		font-size: clamp(38px, 6vw, 64px);
		line-height: 1.05;
	}
	.stage-description {
		color: var(--text-secondary);
		font-size: 15px;
		max-width: 460px;
	}
	.stage-note {
		color: var(--text-secondary);
		font-size: 12px;
		max-width: 380px;
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
		height: 7px;
		width: 7px;
		background: var(--accent-red);
		border-radius: 50%;
		animation: waiting-pulse 1.5s ease-in-out infinite;
	}
	.duel-guide {
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: 370px;
		text-align: left;
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 14px;
		margin-bottom: 10px;
		background: var(--surface);
	}
	.duel-guide p {
		font-size: 12px;
		line-height: 1.7;
		color: var(--text-secondary);
	}
	.guide-shape {
		height: 28px;
		width: 50px;
		flex-shrink: 0;
		border: 2px solid var(--accent-cyan);
		border-radius: 50% 50% 0 0 / 100% 100% 0 0;
		border-bottom: 0;
	}
	.target-text {
		color: var(--accent-cyan);
		font-weight: 600;
	}
	.you-text {
		color: var(--accent-orange);
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
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
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
	.countdown-ready {
		color: var(--accent-purple);
		font-size: 13px;
		font-weight: 650;
	}
	.countdown-number {
		font-family: 'Believe Stronger', sans-serif;
		font-size: clamp(140px, 25vw, 240px);
		color: var(--accent-orange);
		line-height: 0.85;
		margin: 22px 0;
		font-variant-numeric: tabular-nums;
	}
	.duel-play {
		min-height: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 6px 24px 14px;
		width: 100%;
		max-width: 1600px;
		margin: 0 auto;
	}
	.duel-scoreboard {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 100px minmax(0, 1fr);
		gap: 26px;
		align-items: center;
		padding-bottom: 16px;
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
		gap: 7px;
		font-size: 12px;
		font-weight: 650;
		color: var(--text-primary);
		min-width: 0;
	}
	.player-dot {
		display: inline-block;
		height: 7px;
		width: 7px;
		border-radius: 50%;
		background: var(--player-color);
		flex-shrink: 0;
	}
	.player-name,
	.opponent-elo {
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 450;
		margin-left: auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opponent-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opponent-elo {
		flex-shrink: 0;
	}
	.match-value {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-top: 5px;
		gap: 12px;
	}
	.match-value strong {
		font-size: 38px;
		font-weight: 700;
		line-height: 1.1;
		color: var(--player-color);
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.055em;
	}
	.match-value strong span {
		font-size: 19px;
		margin-left: 2px;
		letter-spacing: 0;
	}
	.sample-count {
		color: var(--text-secondary);
		font-size: 11px;
		white-space: nowrap;
	}
	.match-track {
		height: 4px;
		margin-top: 9px;
		border-radius: 4px;
		overflow: hidden;
		background: color-mix(in srgb, var(--player-color) 10%, var(--surface));
	}
	.match-track > div {
		height: 100%;
		background: var(--player-color);
		transition: width 200ms ease-out;
		border-radius: inherit;
	}
	.duel-clock {
		display: flex;
		flex-direction: column;
		align-items: center;
		color: var(--clock-color);
	}
	.duel-clock strong {
		font-size: 36px;
		font-weight: 750;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.04em;
	}
	.duel-clock > span {
		font-size: 10px;
		color: var(--text-secondary);
		margin-top: 2px;
	}
	.duel-clock.critical strong {
		animation: clock-pulse 1s ease-in-out infinite;
	}
	.time-track {
		height: 3px;
		background: var(--surface);
		border-radius: 2px;
		overflow: hidden;
		flex-shrink: 0;
	}
	.time-track > div {
		height: 100%;
		border-radius: inherit;
	}
	.duel-toolbar {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: center;
		padding: 12px 0 10px;
		flex-shrink: 0;
	}
	.duel-standing {
		font-size: 12px;
		color: var(--text-secondary);
	}
	.duel-standing.leading {
		color: var(--accent-orange);
	}
	.duel-standing.trailing {
		color: var(--accent-purple);
	}
	.compare-button {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		border: 1px solid var(--border-hover);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-secondary);
		cursor: pointer;
		flex-shrink: 0;
	}
	.compare-button.active {
		border-color: color-mix(in srgb, var(--accent-purple) 40%, transparent);
		background: color-mix(in srgb, var(--accent-purple) 8%, var(--bg));
		color: var(--accent-purple);
	}
	.duel-canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.duel-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-shrink: 0;
		gap: 12px;
		padding-top: 12px;
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
		border: 1px solid var(--border-hover);
		border-radius: 4px;
		padding: 2px 4px;
	}
	.result-page {
		width: 100%;
		max-width: 1060px;
		margin: auto;
		padding: 30px 24px 48px;
	}
	.result-heading {
		display: flex;
		align-items: center;
		gap: 18px;
		margin-bottom: 28px;
	}
	.result-icon {
		display: grid;
		place-items: center;
		width: 62px;
		height: 62px;
		border: 1px solid var(--border-hover);
		border-radius: 20px;
		color: var(--accent-purple);
		flex-shrink: 0;
	}
	.result-icon.won {
		color: var(--accent-orange);
		background: color-mix(in srgb, var(--accent-orange) 7%, var(--bg));
		border-color: color-mix(in srgb, var(--accent-orange) 20%, transparent);
	}
	.result-heading h1 {
		font-size: clamp(40px, 6vw, 62px);
		line-height: 1;
	}
	.result-heading h1.won {
		color: var(--accent-orange);
	}
	.result-heading p {
		font-size: 13px;
		color: var(--text-secondary);
		margin-top: 7px;
	}
	.result-heading .jackpot-label {
		color: var(--accent-orange);
		font-weight: 700;
		margin: 0 0 5px;
	}
	.result-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px;
		gap: 28px;
		align-items: start;
	}
	.replay-panel {
		min-width: 0;
	}
	h2 {
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 650;
	}
	.replay-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.replay-heading .quiet-button {
		font-size: 11px;
	}
	.result-canvas {
		width: 100%;
		height: 250px;
		border: 1px solid var(--border);
		border-radius: 14px;
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
		color: var(--accent-cyan);
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
		gap: 6px;
		padding: 7px 10px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 11px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.replay-toggle > span {
		width: 14px;
		height: 2px;
		background: var(--toggle-color);
		opacity: 0.35;
	}
	.you-toggle > span {
		background: none;
		border-top: 2px dashed var(--toggle-color);
	}
	.opponent-toggle {
		--toggle-color: var(--accent-purple);
	}
	.replay-toggle.active {
		color: var(--toggle-color);
		border-color: color-mix(in srgb, var(--toggle-color) 25%, var(--border));
		background: color-mix(in srgb, var(--toggle-color) 5%, var(--bg));
	}
	.replay-toggle.active > span {
		opacity: 1;
	}
	.replay-note {
		font-size: 10px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-top: 10px;
	}
	.result-statistics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		margin-top: 24px;
		border-top: 1px solid var(--border);
		padding-top: 18px;
	}
	.result-player {
		--player-color: var(--accent-orange);
		min-width: 0;
	}
	.opponent-result {
		--player-color: var(--accent-purple);
	}
	.result-player-name {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--text-secondary);
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.result-player > strong {
		color: var(--player-color);
		font-size: 34px;
		line-height: 1.4;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
	}
	.result-player > strong span {
		color: var(--text-secondary);
		font-size: 10px;
		font-weight: 450;
		letter-spacing: 0;
		margin-left: 6px;
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
	.result-details {
		border-left: 1px solid var(--border);
		padding-left: 28px;
	}
	.ranking-panel {
		margin-bottom: 22px;
	}
	.rank-current {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 17px 0;
	}
	.rank-current strong {
		display: block;
		font-size: 30px;
		font-weight: 700;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.rank-current span {
		font-size: 11px;
		color: var(--text-secondary);
	}
	.rank-progress {
		height: 4px;
		border-radius: 5px;
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
		font-size: 20px;
		font-weight: 650;
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
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 18px;
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
	@media (max-width: 700px) {
		.duel-play {
			padding: 4px 12px 12px;
		}
		.duel-scoreboard {
			grid-template-columns: minmax(0, 1fr) 64px minmax(0, 1fr);
			gap: 12px;
			padding-bottom: 12px;
		}
		.player-label {
			font-size: 11px;
			gap: 5px;
		}
		.player-name,
		.opponent-elo {
			display: none;
		}
		.match-value {
			display: block;
		}
		.match-value strong {
			font-size: 32px;
		}
		.match-value strong span {
			font-size: 16px;
		}
		.sample-count {
			display: block;
			font-size: 9px;
			margin-top: 3px;
		}
		.duel-clock strong {
			font-size: 30px;
		}
		.duel-clock > span {
			font-size: 9px;
		}
		.duel-standing {
			font-size: 10px;
			line-height: 1.4;
		}
		.compare-button {
			font-size: 10px;
			padding: 7px 8px;
			gap: 5px;
		}
		.duel-toolbar {
			padding: 9px 0;
			gap: 8px;
		}
		.keyboard-hint {
			display: none;
		}
		.duel-footer {
			padding-top: 9px;
		}
		.duel-footer p {
			font-size: 10px;
		}
		.result-page {
			padding: 24px 16px 40px;
			margin: 0 auto;
		}
		.result-heading {
			gap: 12px;
			margin-bottom: 24px;
		}
		.result-heading h1 {
			font-size: 42px;
		}
		.result-icon {
			height: 48px;
			width: 48px;
			border-radius: 15px;
		}
		.result-heading p {
			font-size: 11px;
		}
		.result-layout {
			grid-template-columns: 1fr;
			gap: 28px;
		}
		.result-details {
			padding: 22px 0 0;
			border-left: 0;
			border-top: 1px solid var(--border);
		}
		.ranking-panel {
			max-width: 400px;
		}
		.result-canvas {
			height: 210px;
		}
		.result-player > strong {
			font-size: 30px;
		}
		.result-statistics {
			gap: 16px;
		}
	}
	@media (max-height: 550px) and (orientation: landscape) {
		.duel-scoreboard {
			padding-bottom: 7px;
		}
		.match-value strong {
			font-size: 26px;
		}
		.sample-count,
		.match-track,
		.duel-clock > span,
		.duel-clock :global(svg),
		.duel-footer {
			display: none;
		}
		.duel-toolbar {
			padding: 5px 0;
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
