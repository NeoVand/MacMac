<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { reconstructLevel } from '$lib/game/generator';
	import { getFullScore, type ScoreResult } from '$lib/game/scoring';
	import { linspace } from '$lib/game/math';
	import { computeKDE } from '$lib/game/kde';
	import { joinBattle } from '$lib/battle/client';
	import type { ServerMessage } from '$lib/battle/protocol';
	import type { Level } from '$lib/game/levels';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { getBattleTier } from '$lib/game/elo';
	import { authClient } from '$lib/auth-client';
	import { resolvePlayerName } from '$lib/utils/player-name';
	import { Github } from 'lucide-svelte';

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
	let timerHandle = 0;
	let startTime = 0;

	// Results
	let winnerId = $state('');
	let winnerName = $state('');
	let winnerScore = $state(0);
	let winnerMatchPct = $state(0);
	let loserScore = $state(0);
	let loserMatchPct = $state(0);
	let yourEloDelta = $state(0);
	let isJackpot = $state(false);
	let battleTierName = $state<string | null>(null);
	let battleTierColor = $state<string | null>(null);
	let battleRankUp = $state(false);
	let reportedNewElo = $state<number | null>(null);
	let opponentSamples = $state<number[]>([]);

	// Replay state
	let replayCanvas: HTMLCanvasElement | undefined = $state();
	let replayTimer: number = 0;
	let showYou = $state(true);
	let showOpponent = $state(true);
	let replayIdx = $state(0);
	let yourReplayKde: number[] = [];
	let oppReplayKde: number[] = [];
	let replayXs: number[] = [];
	let replayStepTimer = 0;
	let replayPhase: 'adding' | 'holding' | 'fadingOut' = 'adding';
	let replayPauseTimer = 0;
	let replayFadeTimer = 0;
	let replayFadeFactor = 1;

	const REPLAY_START_DELAY = 12;
	const REPLAY_STEP = 18;
	const REPLAY_HOLD = 90;
	const REPLAY_FADE_OUT = 33;
	const REPLAY_FADE_LERP = 0.22;

	// Score tracking
	const emptyScore: ScoreResult = { mse: 1, clicks: 0, score: 0, matchPct: 0, matchScore: 0, timeBonus: 0, histogramData: [] };
	let scoreResult: ScoreResult = $state({ ...emptyScore });

	let socket: ReturnType<typeof joinBattle> | null = null;

	const myPlayerId = $derived($session.data?.user?.id ?? 'anon-' + battleId);
	const myName = $derived(resolvePlayerName($session.data?.user?.name ?? 'Anonymous'));
	const isWinner = $derived(winnerId === myPlayerId);
	const isAnonymous = $derived(!$session.data?.user);

	// For anonymous users, show hypothetical rank (starting ELO = 1200)
	const anonElo = $derived(1200 + yourEloDelta);
	const anonTier = $derived(getBattleTier(anonElo));

	const timerDisplay = $derived.by(() => {
		const sec = Math.max(0, Math.ceil(timeLeftMs / 1000));
		return `${sec}s`;
	});

	async function signInWith(provider: 'github' | 'google') {
		await authClient.signIn.social({ provider, callbackURL: window.location.href });
	}

	function countryFlag(code: string | null): string {
		if (!code || code.length !== 2) return '';
		return String.fromCodePoint(
			...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
		);
	}

	function handleMessage(msg: ServerMessage) {
		switch (msg.type) {
			case 'waiting':
				phase = 'waiting';
				break;

			case 'countdown':
				phase = 'countdown';
				countdownNum = msg.seconds;
				break;

			case 'start': {
				const gen = reconstructLevel(msg.seed, msg.targetDifficulty);
				level = gen;
				opponentName = msg.opponentName;
				opponentElo = msg.opponentElo;
				opponentCountry = msg.opponentCountry ?? null;
				durationMs = msg.durationMs;
				timeLeftMs = msg.durationMs;
				samples = [];
				opponentKde = [];
				opponentMatchPct = 0;
				scoreResult = { ...emptyScore };
				phase = 'playing';
				startTime = Date.now();
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
				winnerScore = msg.winnerScore;
				winnerMatchPct = msg.winnerMatchPct;
				// battle_end will follow with full results
				break;

			case 'battle_end':
				phase = 'ended';
				winnerId = msg.winnerId;
				winnerName = msg.winnerName;
				winnerScore = msg.winnerScore;
				winnerMatchPct = msg.winnerMatchPct;
				loserScore = msg.loserScore;
				loserMatchPct = msg.loserMatchPct;
				yourEloDelta = msg.yourEloDelta;
				opponentSamples = msg.opponentSamples ?? [];
				stopCountdownTimer();
				if (msg.resultToken) {
					reportBattleResult(msg.resultToken);
				}
				startBattleReplay();
				break;

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
			if (timeLeftMs <= 0 || phase !== 'playing') return;
			timerHandle = requestAnimationFrame(tick);
		}
		tick();
	}

	function stopCountdownTimer() {
		cancelAnimationFrame(timerHandle);
	}

	async function reportBattleResult(resultToken: string) {
		if (isAnonymous) return;
		try {
			const res = await fetch('/api/battles/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ resultToken })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.tierName) battleTierName = data.tierName;
				if (data.tierColor) battleTierColor = data.tierColor;
				if (data.rankUp) battleRankUp = true;
				if (typeof data.newElo === 'number') reportedNewElo = data.newElo;
			}
		} catch {
			// Non-critical — don't disrupt the results screen
		}
	}

	function startBattleReplay() {
		if (!level) return;
		const [xMin, xMax] = level.xRange;
		replayXs = linspace(xMin, xMax, 200);
		replayIdx = 0;
		yourReplayKde = new Array(200).fill(0);
		oppReplayKde = new Array(200).fill(0);
		replayStepTimer = 0;
		replayPhase = 'adding';
		replayPauseTimer = 0;
		replayFadeTimer = 0;
		replayFadeFactor = 1;

		const maxClicks = Math.max(samples.length, opponentSamples.length);

		function frame() {
			if (phase !== 'ended') return;

			if (replayPhase === 'adding') {
				const interval = replayIdx === 0 ? REPLAY_START_DELAY : REPLAY_STEP;
				replayStepTimer++;
				if (replayStepTimer >= interval) {
					replayStepTimer = 0;
					replayIdx++;
					if (replayIdx > maxClicks) {
						replayPhase = 'holding';
						replayPauseTimer = 0;
					}
				}
			} else if (replayPhase === 'holding') {
				replayPauseTimer++;
				if (replayPauseTimer > REPLAY_HOLD) {
					replayPhase = 'fadingOut';
					replayFadeTimer = 0;
				}
			} else {
				replayFadeTimer++;
				for (let i = 0; i < 200; i++) {
					yourReplayKde[i] += (0 - yourReplayKde[i]) * REPLAY_FADE_LERP;
					oppReplayKde[i] += (0 - oppReplayKde[i]) * REPLAY_FADE_LERP;
				}
				replayFadeFactor = Math.max(0, 1 - replayFadeTimer / REPLAY_FADE_OUT);
				if (replayFadeTimer >= REPLAY_FADE_OUT) {
					replayIdx = 0;
					replayStepTimer = 0;
					replayPhase = 'adding';
					replayFadeFactor = 1;
					yourReplayKde = yourReplayKde.map(() => 0);
					oppReplayKde = oppReplayKde.map(() => 0);
				}
			}

			if (replayPhase !== 'fadingOut') {
				const yourSlice = samples.slice(0, Math.min(replayIdx, samples.length));
				const oppSlice = opponentSamples.slice(0, Math.min(replayIdx, opponentSamples.length));
				const yourTarget = yourSlice.length > 0 ? computeKDE(yourSlice, replayXs) : new Array(200).fill(0);
				const oppTarget = oppSlice.length > 0 ? computeKDE(oppSlice, replayXs) : new Array(200).fill(0);
				for (let i = 0; i < 200; i++) {
					yourReplayKde[i] += (yourTarget[i] - yourReplayKde[i]) * 0.12;
					oppReplayKde[i] += (oppTarget[i] - oppReplayKde[i]) * 0.12;
				}
			}

			drawBattleReplay();
			replayTimer = requestAnimationFrame(frame);
		}
		frame();
	}

	function drawBattleReplay() {
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
		const accentCyan = s.getPropertyValue('--accent-cyan').trim();

		ctx.fillStyle = canvasBg;
		ctx.fillRect(0, 0, w, h);

		const pad = 12;
		const pw = w - pad * 2, ph = h - pad * 2;
		const [xMin, xMax] = level.xRange;
		const pdfVals = replayXs.map((x) => level!.pdf(x));
		const pdfMax = Math.max(...pdfVals) || 1;
		const yourMax = yourReplayKde.length > 0 ? Math.max(...yourReplayKde) : 0;
		const oppMax = oppReplayKde.length > 0 ? Math.max(...oppReplayKde) : 0;
		const yMax = Math.max(pdfMax, yourMax, oppMax) * 1.15 || 1;

		const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * pw;
		const toY = (y: number) => pad + ph - (y / yMax) * ph;
		const baseY = toY(0);

		// Axis
		ctx.strokeStyle = 'rgba(128,128,128,0.3)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(pad, baseY);
		ctx.lineTo(pad + pw, baseY);
		ctx.stroke();

		// PDF family (dimmed)
		const pdfScales = linspace(0.08, 1, 20);
		for (let si = 0; si < pdfScales.length; si++) {
			const scale = pdfScales[si];
			const isMain = si === pdfScales.length - 1;
			const alpha = (isMain ? 0.5 : 0.03 + (si / (pdfScales.length - 1)) * 0.25) * 0.5;
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(pdfVals[i] * scale);
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = accentCyan;
			ctx.lineWidth = isMain ? 1.5 : 0.5;
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		const maxClicks = Math.max(samples.length, opponentSamples.length);

		// Your KDE + samples (orange)
		if (showYou && replayIdx > 0 && replayFadeFactor > 0.01) {
			ctx.globalAlpha = replayFadeFactor;
			// Fill
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(Math.min(yourReplayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.lineTo(toX(replayXs[replayXs.length - 1]), baseY);
			ctx.lineTo(toX(replayXs[0]), baseY);
			ctx.closePath();
			const g = ctx.createLinearGradient(0, pad, 0, baseY);
			g.addColorStop(0, 'rgba(251,146,60,0.15)');
			g.addColorStop(1, 'rgba(251,146,60,0.01)');
			ctx.fillStyle = g;
			ctx.fill();
			// Stroke
			ctx.beginPath();
			ctx.strokeStyle = 'rgba(251,146,60,0.7)';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 3]);
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(Math.min(yourReplayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.stroke();
			ctx.setLineDash([]);
			// Dots
			const yourSlice = replayPhase === 'fadingOut' ? samples : samples.slice(0, Math.min(replayIdx, samples.length));
			for (const sp of yourSlice) {
				ctx.fillStyle = 'rgba(251,146,60,0.25)';
				ctx.beginPath(); ctx.arc(toX(sp), baseY, 5, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = 'rgba(251,146,60,0.9)';
				ctx.beginPath(); ctx.arc(toX(sp), baseY, 3, 0, Math.PI * 2); ctx.fill();
			}
			ctx.globalAlpha = 1;
		}

		// Opponent KDE + samples (pink)
		if (showOpponent && replayIdx > 0 && replayFadeFactor > 0.01) {
			ctx.globalAlpha = replayFadeFactor;
			// Fill
			ctx.beginPath();
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(Math.min(oppReplayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.lineTo(toX(replayXs[replayXs.length - 1]), baseY);
			ctx.lineTo(toX(replayXs[0]), baseY);
			ctx.closePath();
			const g2 = ctx.createLinearGradient(0, pad, 0, baseY);
			g2.addColorStop(0, 'rgba(236,72,153,0.15)');
			g2.addColorStop(1, 'rgba(236,72,153,0.01)');
			ctx.fillStyle = g2;
			ctx.fill();
			// Stroke
			ctx.beginPath();
			ctx.strokeStyle = 'rgba(236,72,153,0.6)';
			ctx.lineWidth = 1.5;
			ctx.setLineDash([4, 3]);
			for (let i = 0; i < replayXs.length; i++) {
				const sy = toY(Math.min(oppReplayKde[i], yMax * 0.99));
				i === 0 ? ctx.moveTo(toX(replayXs[i]), sy) : ctx.lineTo(toX(replayXs[i]), sy);
			}
			ctx.stroke();
			ctx.setLineDash([]);
			// Dots
			const oppSlice = replayPhase === 'fadingOut' ? opponentSamples : opponentSamples.slice(0, Math.min(replayIdx, opponentSamples.length));
			for (const sp of oppSlice) {
				ctx.fillStyle = 'rgba(236,72,153,0.25)';
				ctx.beginPath(); ctx.arc(toX(sp), baseY, 5, 0, Math.PI * 2); ctx.fill();
				ctx.fillStyle = 'rgba(236,72,153,0.9)';
				ctx.beginPath(); ctx.arc(toX(sp), baseY, 3, 0, Math.PI * 2); ctx.fill();
			}
			ctx.globalAlpha = 1;
		}
	}

	function handleSampleAdd(x: number) {
		if (phase !== 'playing' || !level) return;
		samples = [...samples, x];
		socket?.addSample(x);

		// Recalc local score
		const elapsed = Date.now() - startTime;
		scoreResult = { ...getFullScore(samples, level, elapsed), clicks: samples.length };
	}

	onMount(() => {
		// Small delay to ensure session is loaded
		const timeout = setTimeout(() => {
			socket = joinBattle(
				battleId,
				myPlayerId,
				myName,
				1200, // default ELO, server has actual value
				null, // country not available on battle page (set via matchmaker)
				handleMessage,
				(err) => console.error('Battle connection error:', err)
			);
		}, 100);

		// Safety timeout: if stuck on connecting for too long, show expired
		const connTimeout = setTimeout(() => {
			if (phase === 'connecting') {
				phase = 'expired';
			}
		}, 8000);

		return () => {
			clearTimeout(timeout);
			clearTimeout(connTimeout);
			stopCountdownTimer();
			cancelAnimationFrame(replayTimer);
			socket?.close();
		};
	});
</script>

<svelte:head>
	<title>Battle — macmac</title>
</svelte:head>

{#if phase === 'connecting' || phase === 'waiting'}
	<!-- Waiting for opponent -->
	<div class="flex h-dvh flex-col" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader  />
		<div class="flex flex-1 flex-col items-center justify-center gap-4">
			<div class="relative flex h-16 w-16 items-center justify-center">
				<div class="absolute inset-0 animate-spin rounded-full" style="border: 2px solid transparent; border-top-color: var(--accent-red); animation-duration: 1.2s;"></div>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-7 w-7" style="color: var(--accent-red);">
					<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 7l6-6h3v3l-6 6" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M3 3l18 18" stroke-linecap="round" opacity="0.3"/>
				</svg>
			</div>
			<div class="text-sm font-medium" style="color: var(--text-secondary);">
				{phase === 'connecting' ? 'Connecting...' : 'Waiting for opponent...'}
			</div>
			<button
				onclick={() => { socket?.close(); goto('/'); }}
				class="mt-2 rounded-xl px-4 py-2 text-[12px] font-medium transition hover:opacity-80"
				style="background: var(--surface); border: 1px solid var(--border); color: var(--text-tertiary);"
			>
				Cancel
			</button>
		</div>
	</div>

{:else if phase === 'countdown'}
	<!-- Countdown overlay -->
	<div class="flex h-dvh flex-col" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader  />
		<div class="flex flex-1 flex-col items-center justify-center gap-3">
			<div class="text-sm font-medium" style="color: var(--text-secondary);">
				vs <span style="color: var(--text-primary);">{#if opponentCountry}{countryFlag(opponentCountry)} {/if}{opponentName}</span>
				<span class="ml-1 text-[10px] tabular-nums" style="color: var(--accent-purple);">ELO {opponentElo}</span>
			</div>
			<div
				class="text-8xl font-black tabular-nums sm:text-9xl"
				style="color: var(--accent-red); text-shadow: 0 0 40px color-mix(in srgb, var(--accent-red) 40%, transparent);"
			>
				{countdownNum}
			</div>
		</div>
	</div>

{:else if phase === 'playing' && level}
	<!-- Battle gameplay -->
	<div class="flex h-dvh flex-col overflow-hidden" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader  />

		<!-- Battle HUD -->
		<div class="flex shrink-0 items-center justify-between px-4 pb-1.5 sm:px-6">
			<!-- Your score -->
			<div class="flex items-center gap-3">
				<div>
					<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">You</div>
					<div class="text-lg font-bold tabular-nums leading-none" style="color: var(--accent-cyan);">
						{scoreResult.matchPct}%
					</div>
				</div>
				<div>
					<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">Score</div>
					<div class="text-lg font-bold tabular-nums leading-none" style="color: var(--text-primary);">
						{scoreResult.score.toLocaleString()}
					</div>
				</div>
			</div>

			<!-- Timer -->
			<div class="text-center">
				<div
					class="text-2xl font-black tabular-nums"
					style="color: var(--accent-red);"
				>
					{timerDisplay}
				</div>
			</div>

			<!-- Opponent -->
			<div class="flex items-center gap-3 text-right">
				<div>
					<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">Match</div>
					<div class="text-lg font-bold tabular-nums leading-none" style="color: rgba(236,72,153,0.8);">
						{opponentMatchPct}%
					</div>
				</div>
				<div>
					<div class="text-sm font-semibold leading-none" style="color: var(--text-primary);">
						{#if opponentCountry}{countryFlag(opponentCountry)} {/if}{opponentName}
					</div>
					<div class="mt-0.5 text-[10px] tabular-nums" style="color: var(--accent-purple);">
						ELO {opponentElo}
					</div>
				</div>
			</div>
		</div>

		<!-- Time progress bar -->
		<div class="mx-4 mb-1 h-1 overflow-hidden rounded-full sm:mx-6" style="background: var(--surface);">
			<div
				class="h-full rounded-full transition-all duration-200"
				style="width: {(timeLeftMs / durationMs) * 100}%; background: var(--accent-red);"
			></div>
		</div>

		<!-- Canvas -->
		<div class="relative min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas {level} {samples} onSampleAdd={handleSampleAdd} {opponentKde} />
		</div>

		<!-- Bottom: click count + undo -->
		<div class="shrink-0 px-4 pb-4 pt-2 sm:px-6 sm:pb-5">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-3">
					<span class="text-sm font-bold tabular-nums" style="color: var(--accent-orange);">
						{samples.length} clicks
					</span>
				</div>
				<button
					onclick={() => { if (samples.length > 0) { samples = samples.slice(0, -1); } }}
					disabled={samples.length === 0}
					class="flex h-10 items-center gap-2 rounded-2xl px-4 text-[13px] font-medium transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-20"
					style="background: color-mix(in srgb, var(--accent-purple) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-purple) 18%, transparent); color: color-mix(in srgb, var(--accent-purple) 70%, var(--text-primary));"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
					Undo
				</button>
			</div>
		</div>
	</div>

	<!-- Jackpot flash overlay -->
	{#if isJackpot && phase === 'playing'}
		<div class="fixed inset-0 z-50 flex items-center justify-center" style="background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);">
			<div class="text-center">
				<div class="mb-2 text-6xl font-black sm:text-8xl" style="color: #eab308; text-shadow: 0 0 60px rgba(234,179,8,0.5);">
					JACKPOT!
				</div>
				<div class="text-lg font-medium" style="color: var(--text-secondary);">
					{winnerName} hit {winnerMatchPct}% accuracy
				</div>
			</div>
		</div>
	{/if}

{:else if phase === 'ended'}
	<!-- Results -->
	<div class="flex h-dvh flex-col" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader  />

		<div class="flex flex-1 flex-col items-center justify-center px-4">
			<div class="w-full max-w-sm rounded-2xl p-6 shadow-2xl" style="background: var(--bg); border: 1px solid var(--border);">
				<!-- Result header -->
				{#if isJackpot}
					<div class="mb-4 text-center text-3xl font-black" style="color: #eab308; text-shadow: 0 0 30px rgba(234,179,8,0.3);">
						JACKPOT!
					</div>
				{/if}

				<div class="mb-4 text-center">
					<div
						class="text-3xl font-black sm:text-4xl"
						style="color: {isWinner ? 'var(--win-green)' : 'var(--loss-red)'};"
					>
						{isWinner ? 'You Won!' : 'You Lost'}
					</div>
					<div class="mt-1 text-sm" style="color: var(--text-tertiary);">
						vs {#if opponentCountry}{countryFlag(opponentCountry)} {/if}{opponentName}
					</div>
				</div>

				<!-- Replay canvas -->
				<canvas bind:this={replayCanvas} class="mb-2 h-28 w-full rounded-lg sm:h-36" style="background: var(--canvas-bg);"></canvas>
				<!-- Toggle controls -->
				<div class="mb-4 flex justify-center gap-2">
					<button
						onclick={() => showYou = !showYou}
						class="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold transition"
						style="background: {showYou ? 'rgba(251,146,60,0.15)' : 'var(--surface)'}; border: 1px solid {showYou ? 'rgba(251,146,60,0.3)' : 'var(--border)'}; color: {showYou ? 'rgb(251,146,60)' : 'var(--text-tertiary)'};"
					>
						<span class="inline-block h-2 w-2 rounded-full" style="background: {showYou ? 'rgb(251,146,60)' : 'var(--text-tertiary)'}; opacity: {showYou ? 1 : 0.3};"></span>
						You
					</button>
					<button
						onclick={() => showOpponent = !showOpponent}
						class="flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold transition"
						style="background: {showOpponent ? 'rgba(236,72,153,0.15)' : 'var(--surface)'}; border: 1px solid {showOpponent ? 'rgba(236,72,153,0.3)' : 'var(--border)'}; color: {showOpponent ? 'rgb(236,72,153)' : 'var(--text-tertiary)'};"
					>
						<span class="inline-block h-2 w-2 rounded-full" style="background: {showOpponent ? 'rgb(236,72,153)' : 'var(--text-tertiary)'}; opacity: {showOpponent ? 1 : 0.3};"></span>
						{opponentName}
					</button>
				</div>

				<!-- Score comparison -->
				<div class="mb-5 flex justify-between rounded-xl p-3" style="background: var(--surface);">
					<div class="text-center">
						<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">
							{isWinner ? 'Your Score' : 'Opponent'}
						</div>
						<div class="text-xl font-bold tabular-nums" style="color: var(--win-green);">
							{winnerScore.toLocaleString()}
						</div>
						<div class="text-xs tabular-nums" style="color: var(--text-tertiary);">
							{winnerMatchPct}% match
						</div>
					</div>
					<div class="flex items-center">
						<span class="text-lg font-bold" style="color: var(--text-tertiary);">vs</span>
					</div>
					<div class="text-center">
						<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">
							{isWinner ? 'Opponent' : 'Your Score'}
						</div>
						<div class="text-xl font-bold tabular-nums" style="color: var(--loss-red);">
							{loserScore.toLocaleString()}
						</div>
						<div class="text-xs tabular-nums" style="color: var(--text-tertiary);">
							{loserMatchPct}% match
						</div>
					</div>
				</div>

				<!-- ELO change + Battle rank -->
				<div class="mb-5 text-center">
					{#if battleRankUp && battleTierName}
						<div class="rank-up-anim mb-1 text-center text-xs font-bold uppercase tracking-wider" style="color: {battleTierColor};">
							Rank Up! — {battleTierName}
						</div>
					{/if}
					{#if reportedNewElo !== null}
						<div class="mb-1 flex items-center justify-center gap-2">
							<RankBadge mode="battle" value={reportedNewElo} size="lg" />
							<span class="text-lg font-bold tabular-nums" style="color: {battleTierColor ?? 'var(--accent-red)'};">
								{reportedNewElo}
							</span>
						</div>
					{:else if isAnonymous}
						<div class="mb-1 flex items-center justify-center gap-2">
							<RankBadge mode="battle" value={anonElo} size="lg" />
							<span class="text-lg font-bold tabular-nums" style="color: {anonTier.color};">
								{anonElo}
							</span>
						</div>
						<div class="mb-1 text-[10px] font-medium" style="color: {anonTier.color};">
							{anonTier.name}
						</div>
					{/if}
					<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">ELO Change</div>
					<div
						class="text-2xl font-bold tabular-nums"
						style="color: {yourEloDelta >= 0 ? 'var(--win-green)' : 'var(--loss-red)'};"
					>
						{yourEloDelta >= 0 ? '+' : ''}{yourEloDelta}
					</div>
				</div>

				<!-- Sign-in prompt for anonymous users -->
				{#if isAnonymous}
					<div class="mb-4 rounded-xl p-4 text-center" style="background: color-mix(in srgb, var(--accent-red) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-red) 20%, transparent);">
						<div class="mb-2.5 text-xs font-medium" style="color: var(--accent-red);">
							Sign in to save your ranking
						</div>
						<div class="flex flex-col gap-2">
							<button onclick={() => signInWith('github')} class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">
								<Github size={14} /> Continue with GitHub
							</button>
							<button onclick={() => signInWith('google')} class="flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition hover:opacity-80" style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);">
								<svg viewBox="0 0 24 24" class="h-3.5 w-3.5"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
								Continue with Google
							</button>
						</div>
					</div>
				{/if}

				<!-- Actions -->
				<div class="flex gap-2">
					<a
						href="/"
						class="flex flex-1 items-center justify-center rounded-xl py-2.5 text-sm font-medium transition hover:opacity-80"
						style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);"
					>
						Home
					</a>
					<a
						href="/?battle"
						class="flex flex-1 items-center justify-center rounded-xl py-2.5 text-sm font-semibold transition hover:opacity-80"
						style="background: color-mix(in srgb, var(--accent-red) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-red) 25%, transparent); color: var(--accent-red);"
					>
						Rematch
					</a>
				</div>
			</div>
		</div>
	</div>

{:else if phase === 'expired'}
	<!-- Battle expired / no longer available -->
	<div class="flex h-dvh flex-col" style="background: radial-gradient(ellipse at 50% 30%, var(--page-bg-center) 0%, var(--page-bg-edge) 70%);">
		<AppHeader  />
		<div class="flex flex-1 flex-col items-center justify-center gap-4 px-4">
			<div class="text-lg font-semibold" style="color: var(--text-secondary);">
				This battle has ended
			</div>
			<div class="text-sm" style="color: var(--text-tertiary);">
				The battle is no longer available. Start a new one!
			</div>
			<div class="mt-2 flex gap-3">
				<a
					href="/"
					class="rounded-xl px-5 py-2.5 text-sm font-medium transition hover:opacity-80"
					style="background: var(--surface); border: 1px solid var(--border); color: var(--text-secondary);"
				>
					Home
				</a>
				<a
					href="/?battle"
					class="rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-80"
					style="background: color-mix(in srgb, var(--accent-red) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-red) 25%, transparent); color: var(--accent-red);"
				>
					New Battle
				</a>
			</div>
		</div>
	</div>
{/if}
