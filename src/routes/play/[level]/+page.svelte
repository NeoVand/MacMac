<script lang="ts">
	import { page } from '$app/state';
	import { getLevel, levels } from '$lib/game/levels';
	import { getFullScore, getDifficultyColor, type ScoreResult } from '$lib/game/scoring';
	import GameCanvas from '$lib/components/GameCanvas.svelte';
	import ScorePanel from '$lib/components/ScorePanel.svelte';

	const levelId = $derived(Number(page.params.level));
	const level = $derived(getLevel(levelId));

	let samples: number[] = $state([]);
	let scoreResult: ScoreResult = $state({
		kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: []
	});

	let isSubmitting = $state(false);
	let showSubmitDialog = $state(false);
	let playerName = $state('');
	let submitMessage = $state('');

	$effect(() => {
		void levelId;
		samples = [];
		scoreResult = { kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: [] };
		showSubmitDialog = false;
		submitMessage = '';
		const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('macmac_player_name') : null;
		if (saved) playerName = saved;
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
			: { kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: [] };
	}

	function resetSamples() {
		samples = [];
		scoreResult = { kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: [] };
		submitMessage = '';
	}

	function openSubmit() {
		if (samples.length < 3) {
			submitMessage = 'Place at least 3 samples';
			return;
		}
		showSubmitDialog = true;
	}

	async function submitScore() {
		if (!level || !playerName.trim()) return;
		isSubmitting = true;
		submitMessage = '';
		try {
			if (typeof localStorage !== 'undefined')
				localStorage.setItem('macmac_player_name', playerName.trim());
			let playerId = typeof localStorage !== 'undefined'
				? localStorage.getItem('macmac_player_id') : null;
			if (!playerId) {
				playerId = crypto.randomUUID();
				if (typeof localStorage !== 'undefined')
					localStorage.setItem('macmac_player_id', playerId);
			}
			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerName: playerName.trim(), playerId, levelId: level.id,
					score: scoreResult.score, klDivergence: scoreResult.kl,
					clicks: scoreResult.clicks, samples
				})
			});
			const data = await res.json();
			if (data.success) {
				submitMessage = data.isNewBest ? 'New best!' : `Best: ${data.bestScore.toLocaleString()}`;
				showSubmitDialog = false;
			} else {
				submitMessage = data.error || 'Failed';
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
				<a
					href="/"
					class="text-xs font-semibold text-white/40 transition hover:text-white/70"
				>
					MacMac
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
					<a
						href="/play/{prevLevel}"
						class="flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70"
						aria-label="Previous level"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
					</a>
				{/if}
				{#if nextLevel}
					<a
						href="/play/{nextLevel}"
						class="flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70"
						aria-label="Next level"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
					</a>
				{/if}
				<a
					href="/leaderboard"
					class="ml-1 flex h-9 w-9 items-center justify-center rounded-full text-white/30 transition hover:bg-white/5 hover:text-white/70"
					aria-label="Leaderboard"
				>
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684zM13.949 13.684a1 1 0 00-1.898 0l-.184.551a1 1 0 01-.632.633l-.551.183a1 1 0 000 1.898l.551.183a1 1 0 01.633.633l.183.551a1 1 0 001.898 0l.184-.551a1 1 0 01.632-.633l.551-.183a1 1 0 000-1.898l-.551-.184a1 1 0 01-.633-.632l-.183-.551z" /></svg>
				</a>
			</div>
		</div>

		<!-- Score panel -->
		<div class="shrink-0 px-4 pb-2 sm:px-6">
			<ScorePanel {scoreResult} par={level.par} />
		</div>

		<!-- Canvas: fills remaining vertical space -->
		<div class="min-h-0 flex-1 px-2 sm:px-4">
			<GameCanvas {level} {samples} onSampleAdd={addSample} />
		</div>

		<!-- Bottom controls — always accessible, never overlaid -->
		<div class="shrink-0 px-4 py-3 sm:px-6">
			<div class="flex items-center justify-between">
				<div class="flex gap-2">
					<button
						onclick={undoLast}
						disabled={samples.length === 0}
						class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-20"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" /></svg>
						Undo
					</button>
					<button
						onclick={resetSamples}
						disabled={samples.length === 0}
						class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.06] px-4 text-sm font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-20"
					>
						<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" /></svg>
						Reset
					</button>
				</div>

				<div class="flex items-center gap-3">
					{#if submitMessage}
						<span class="text-xs font-medium text-game-cyan">{submitMessage}</span>
					{/if}
					<button
						onclick={openSubmit}
						disabled={samples.length < 3}
						class="flex h-11 items-center gap-2 rounded-xl bg-game-cyan px-6 text-sm font-bold text-game-bg transition hover:brightness-110 active:scale-95 disabled:opacity-20"
					>
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

	<!-- Submit Dialog -->
	{#if showSubmitDialog}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
			role="dialog"
			aria-modal="true"
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="mx-4 w-full max-w-xs rounded-2xl bg-[#14142a]/95 p-6 shadow-2xl backdrop-blur-xl"
				onkeydown={(e) => e.key === 'Escape' && (showSubmitDialog = false)}
			>
				<h3 class="mb-1 text-lg font-bold text-white">Submit Score</h3>
				<p class="mb-4 text-xs text-white/30">
					{scoreResult.score.toLocaleString()} pts · {scoreResult.clicks} clicks
				</p>
				<input
					type="text"
					bind:value={playerName}
					maxlength="24"
					placeholder="Your name"
					class="mb-4 w-full rounded-xl bg-white/5 px-4 py-3 text-sm text-white placeholder-white/20 outline-none ring-1 ring-white/10 transition focus:ring-game-cyan/40"
				/>
				<div class="flex gap-2">
					<button
						onclick={() => (showSubmitDialog = false)}
						class="flex-1 rounded-xl bg-white/5 py-2.5 text-sm font-medium text-white/40 transition hover:bg-white/10"
					>
						Cancel
					</button>
					<button
						onclick={submitScore}
						disabled={!playerName.trim() || isSubmitting}
						class="flex-1 rounded-xl bg-game-cyan py-2.5 text-sm font-bold text-game-bg transition hover:brightness-110 disabled:opacity-30"
					>
						{isSubmitting ? 'Saving…' : 'Submit'}
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
