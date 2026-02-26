<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { reconstructLevel } from '$lib/game/generator';
	import { getFullScore, type ScoreResult } from '$lib/game/scoring';
	import { joinBattle } from '$lib/battle/client';
	import type { ServerMessage } from '$lib/battle/protocol';
	import type { Level } from '$lib/game/levels';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { authClient } from '$lib/auth-client';
	import { resolvePlayerName } from '$lib/utils/player-name';

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

	// Score tracking
	const emptyScore: ScoreResult = { mse: 1, clicks: 0, score: 0, matchPct: 0, matchScore: 0, timeBonus: 0, histogramData: [] };
	let scoreResult: ScoreResult = $state({ ...emptyScore });

	let socket: ReturnType<typeof joinBattle> | null = null;

	const myPlayerId = $derived($session.data?.user?.id ?? 'anon-' + battleId);
	const myName = $derived(resolvePlayerName($session.data?.user?.name ?? 'Anonymous'));
	const isWinner = $derived(winnerId === myPlayerId);
	const isAnonymous = $derived(!$session.data?.user);

	const timerDisplay = $derived.by(() => {
		const sec = Math.max(0, Math.ceil(timeLeftMs / 1000));
		return `${sec}s`;
	});

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
				stopCountdownTimer();
				reportBattleResult(msg.winnerId === myPlayerId, msg.yourEloDelta);
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

	async function reportBattleResult(won: boolean, eloDelta: number) {
		if (isAnonymous) return;
		try {
			await fetch('/api/battles/report', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ won, eloDelta })
			});
		} catch {
			// Non-critical — don't disrupt the results screen
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
				<div class="absolute inset-0 animate-spin rounded-full" style="border: 2px solid transparent; border-top-color: var(--accent-cyan); animation-duration: 1.2s;"></div>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-7 w-7" style="color: var(--accent-cyan);">
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
				style="color: var(--accent-cyan); text-shadow: 0 0 40px color-mix(in srgb, var(--accent-cyan) 40%, transparent);"
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
					style="color: {timeLeftMs <= 5000 ? '#ef4444' : 'var(--accent-cyan)'};"
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
				style="width: {(timeLeftMs / durationMs) * 100}%; background: {timeLeftMs <= 5000 ? '#ef4444' : 'var(--accent-cyan)'};"
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

				<div class="mb-5 text-center">
					<div
						class="text-3xl font-black sm:text-4xl"
						style="color: {isWinner ? '#4ade80' : '#ef4444'};"
					>
						{isWinner ? 'You Won!' : 'You Lost'}
					</div>
					<div class="mt-1 text-sm" style="color: var(--text-tertiary);">
						vs {#if opponentCountry}{countryFlag(opponentCountry)} {/if}{opponentName}
					</div>
				</div>

				<!-- Score comparison -->
				<div class="mb-5 flex justify-between rounded-xl p-3" style="background: var(--surface);">
					<div class="text-center">
						<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">
							{isWinner ? 'Your Score' : 'Opponent'}
						</div>
						<div class="text-xl font-bold tabular-nums" style="color: #4ade80;">
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
						<div class="text-xl font-bold tabular-nums" style="color: #ef4444;">
							{loserScore.toLocaleString()}
						</div>
						<div class="text-xs tabular-nums" style="color: var(--text-tertiary);">
							{loserMatchPct}% match
						</div>
					</div>
				</div>

				<!-- ELO change -->
				<div class="mb-5 text-center">
					<div class="text-[9px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">ELO Change</div>
					<div
						class="text-2xl font-bold tabular-nums"
						style="color: {yourEloDelta >= 0 ? '#4ade80' : '#ef4444'};"
					>
						{yourEloDelta >= 0 ? '+' : ''}{yourEloDelta}
					</div>
					{#if isAnonymous}
						<div class="mt-1 text-[10px]" style="color: var(--text-tertiary);">(not saved)</div>
					{/if}
				</div>

				<!-- Sign-in prompt for anonymous users -->
				{#if isAnonymous}
					<div class="mb-4 rounded-xl p-3 text-center" style="background: color-mix(in srgb, var(--accent-cyan) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 20%, transparent);">
						<div class="text-xs font-medium" style="color: var(--accent-cyan);">
							Sign in to save your ranking
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
						style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);"
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
					style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);"
				>
					New Battle
				</a>
			</div>
		</div>
	</div>
{/if}
