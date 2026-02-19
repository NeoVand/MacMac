<script lang="ts">
	import { page } from '$app/state';
	import { getLevel, levels } from '$lib/game/levels';
	import { getFullScore, getDifficultyColor, type ScoreResult } from '$lib/game/scoring';
	import { authClient } from '$lib/auth-client';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import ScorePanel from '$lib/components/ScorePanel.svelte';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import { ZoomIn, ZoomOut, Fullscreen, Github } from 'lucide-svelte';

	let { data } = $props();

	const levelId = $derived(Number(page.params.level));
	const level = $derived(getLevel(levelId));
	const topScore = $derived(data.topScore ?? 0);

	const session = authClient.useSession();

	let gameCanvas: ReturnType<typeof GameCanvas> | undefined = $state();

	let samples: number[] = $state([]);
	let scoreResult: ScoreResult = $state({
		kl: Infinity, clicks: 0, score: 0, accuracyPct: 0, histogramData: []
	});

	let isSubmitting = $state(false);
	let showSubmitDialog = $state(false);
	let showSignIn = $state(false);
	let submitMessage = $state('');

	$effect(() => {
		void levelId;
		samples = [];
		scoreResult = { kl: Infinity, clicks: 0, score: 0, accuracyPct: 0, histogramData: [] };
		showSubmitDialog = false;
		showSignIn = false;
		submitMessage = '';
	});

	function addSample(x: number) {
		if (!level) return;
		samples = [...samples, x];
		scoreResult = getFullScore(samples, level);
	}

	function undoLast() {
		if (samples.length === 0 || !level) return;
		samples = samples.slice(0, -1);
		scoreResult = samples.length > 0
			? getFullScore(samples, level)
			: { kl: Infinity, clicks: 0, score: 0, accuracyPct: 0, histogramData: [] };
	}

	function resetSamples() {
		samples = [];
		scoreResult = { kl: Infinity, clicks: 0, score: 0, accuracyPct: 0, histogramData: [] };
		submitMessage = '';
	}

	function openSubmit() {
		if (samples.length < 3) {
			submitMessage = 'Place at least 3 samples';
			return;
		}
		if (!$session.data) {
			showSignIn = true;
			return;
		}
		showSubmitDialog = true;
	}

	async function signInWith(provider: 'github' | 'google') {
		await authClient.signIn.social({ provider, callbackURL: window.location.href });
	}

	async function submitScore() {
		if (!level || !$session.data) return;
		isSubmitting = true;
		submitMessage = '';
		try {
			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ levelId: level.id, samples })
			});
			const result = await res.json();
			if (result.success) {
				submitMessage = result.isNewBest ? 'New best!' : `Best: ${result.bestScore.toLocaleString()}`;
				showSubmitDialog = false;
			} else {
				submitMessage = result.error || 'Failed';
			}
		} catch {
			submitMessage = 'Network error';
		} finally {
			isSubmitting = false;
		}
	}

	const prevLevel = $derived(levelId > 1 ? levelId - 1 : null);
	const nextLevel = $derived(levelId < levels.length ? levelId + 1 : null);
</script>

<svelte:head>
	<title>{level ? level.name : 'Not Found'} — MacMac</title>
</svelte:head>

{#if !level}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="text-center">
			<div class="mb-2 text-white/20">Level not found</div>
			<a href="/" class="text-sm text-game-cyan hover:underline">Home</a>
		</div>
	</div>
{:else}
	<div class="flex h-dvh flex-col overflow-hidden bg-game-bg">
		<!-- Top bar -->
		<div class="flex shrink-0 items-center justify-between px-4 py-2 sm:px-6">
			<div class="flex items-center gap-2.5">
				<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
					<span class="text-xs text-white/50">mac</span><span class="text-xs text-game-cyan/50">mac</span>
				</a>
				<span class="text-white/10">/</span>
				<div class="flex items-center gap-1.5">
					<span
						class="inline-block h-2 w-2 rounded-full"
						style="background: {getDifficultyColor(level.difficulty)}"
					></span>
					<span class="text-sm font-semibold text-white/70">
						{level.id}. {level.name}
					</span>
				</div>
			</div>

			<div class="flex items-center gap-1">
				{#if prevLevel}
					<a href="/play/{prevLevel}" class="flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70" aria-label="Previous level">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
					</a>
				{/if}
				{#if nextLevel}
					<a href="/play/{nextLevel}" class="flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70" aria-label="Next level">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
					</a>
				{/if}
				<a href="/leaderboard" class="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70" aria-label="Leaderboard">
					<svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
				</a>
				<div class="ml-1">
					<UserAvatar size="sm" />
				</div>
			</div>
		</div>

		<!-- Score panel -->
		<div class="shrink-0 px-4 pb-2 sm:px-6">
			<ScorePanel {scoreResult} {topScore} />
		</div>

		<!-- Canvas with floating zoom controls -->
		<div class="relative min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas bind:this={gameCanvas} {level} {samples} onSampleAdd={addSample} />
			<div class="absolute right-4 top-3 flex flex-col gap-1 sm:right-6">
				<button onclick={() => gameCanvas?.zoomIn()} class="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.04] text-white/30 transition hover:bg-white/[0.08] hover:text-white/60" aria-label="Zoom in"><ZoomIn size={14} /></button>
				<button onclick={() => gameCanvas?.zoomOut()} class="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.04] text-white/30 transition hover:bg-white/[0.08] hover:text-white/60" aria-label="Zoom out"><ZoomOut size={14} /></button>
				<button onclick={() => gameCanvas?.resetZoom()} class="flex h-7 w-7 items-center justify-center rounded-md bg-white/[0.04] text-white/30 transition hover:bg-white/[0.08] hover:text-white/60" aria-label="Reset view"><Fullscreen size={14} /></button>
			</div>
		</div>

		<!-- Bottom controls -->
		<div class="shrink-0 px-4 py-3 sm:px-6">
			<div class="flex items-center justify-between">
				<div class="flex gap-2">
					<button onclick={undoLast} disabled={samples.length === 0} class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-20">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
						Undo
					</button>
					<button onclick={resetSamples} disabled={samples.length === 0} class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-20">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
						Reset
					</button>
				</div>

				<div class="flex items-center gap-3">
					{#if submitMessage}
						<span class="text-xs font-medium text-game-cyan">{submitMessage}</span>
					{/if}
					<button onclick={openSubmit} disabled={samples.length < 3} class="flex h-11 items-center gap-2 rounded-xl border border-game-cyan/30 bg-game-cyan/10 px-5 text-sm font-semibold text-game-cyan transition hover:border-game-cyan/50 hover:bg-game-cyan/15 active:scale-95 disabled:opacity-20">
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" /></svg>
						Submit
					</button>
				</div>
			</div>
			<div class="mt-1 text-center text-[10px] text-white/15">
				click to sample · scroll to zoom · shift+drag to pan
			</div>
		</div>
	</div>

	<!-- Sign-in dialog (shown when trying to submit without auth) -->
	{#if showSignIn && !$session.data}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onclick={(e) => { if (e.target === e.currentTarget) showSignIn = false; }}
			onkeydown={(e) => e.key === 'Escape' && (showSignIn = false)}
		>
			<div class="mx-4 w-full max-w-xs rounded-2xl border border-white/[0.06] bg-game-bg p-6 shadow-2xl">
				<h3 class="mb-1 text-base font-bold text-white" style="font-family: 'Space Grotesk', sans-serif;">Sign in to submit</h3>
				<p class="mb-5 text-xs text-white/25">
					{scoreResult.score.toLocaleString()} pts · {scoreResult.clicks} clicks · {scoreResult.accuracyPct}% accuracy
				</p>
				<div class="flex flex-col gap-2">
					<button onclick={() => signInWith('github')} class="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-white/60 transition hover:border-white/15 hover:bg-white/[0.06]">
						<Github size={16} />
						Continue with GitHub
					</button>
					<button onclick={() => signInWith('google')} class="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-white/60 transition hover:border-white/15 hover:bg-white/[0.06]">
						<svg viewBox="0 0 24 24" class="h-4 w-4"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
						Continue with Google
					</button>
				</div>
				<button onclick={() => (showSignIn = false)} class="mt-3 w-full text-center text-xs text-white/20 transition hover:text-white/40">Cancel</button>
			</div>
		</div>
	{/if}

	<!-- Submit confirmation (shown when signed in) -->
	{#if showSubmitDialog && $session.data}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
			onclick={(e) => { if (e.target === e.currentTarget) showSubmitDialog = false; }}
			onkeydown={(e) => e.key === 'Escape' && (showSubmitDialog = false)}
		>
			<div class="mx-4 w-full max-w-xs rounded-2xl border border-white/[0.06] bg-game-bg p-6 shadow-2xl">
				<h3 class="mb-1 text-base font-bold text-white" style="font-family: 'Space Grotesk', sans-serif;">Submit Score</h3>
				<p class="mb-4 text-xs text-white/25">
					{scoreResult.score.toLocaleString()} pts · {scoreResult.clicks} clicks · {scoreResult.accuracyPct}% accuracy
				</p>
				<div class="mb-5 flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2.5">
					{#if $session.data.user.image}
						<img src={$session.data.user.image} alt="" class="h-8 w-8 rounded-full" />
					{/if}
					<div>
						<div class="text-sm font-medium text-white/70">{$session.data.user.name}</div>
						<div class="text-[10px] text-white/25">{$session.data.user.email}</div>
					</div>
				</div>
				<div class="flex gap-2">
					<button onclick={() => (showSubmitDialog = false)} class="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.02] py-2.5 text-sm font-medium text-white/35 transition hover:border-white/10 hover:text-white/55">
						Cancel
					</button>
					<button onclick={submitScore} disabled={isSubmitting} class="flex-1 rounded-lg border border-game-cyan/30 bg-game-cyan/10 py-2.5 text-sm font-semibold text-game-cyan transition hover:border-game-cyan/50 hover:bg-game-cyan/15 disabled:opacity-25">
						{isSubmitting ? 'Saving…' : 'Submit'}
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
