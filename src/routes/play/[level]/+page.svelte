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
		scoreResult = samples.length > 0 ? getFullScore(samples, level) : {
			kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: []
		};
	}

	function resetSamples() {
		samples = [];
		scoreResult = { kl: Infinity, clicks: 0, score: 0, accuracyRating: 0, histogramData: [] };
		submitMessage = '';
	}

	function openSubmit() {
		if (samples.length < 3) {
			submitMessage = 'Place at least 3 samples first.';
			return;
		}
		showSubmitDialog = true;
	}

	async function submitScore() {
		if (!level || !playerName.trim()) return;
		isSubmitting = true;
		submitMessage = '';
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('macmac_player_name', playerName.trim());
			}
			let playerId = typeof localStorage !== 'undefined' ? localStorage.getItem('macmac_player_id') : null;
			if (!playerId) {
				playerId = crypto.randomUUID();
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem('macmac_player_id', playerId);
				}
			}
			const res = await fetch('/api/scores', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					playerName: playerName.trim(),
					playerId,
					levelId: level.id,
					score: scoreResult.score,
					klDivergence: scoreResult.kl,
					clicks: scoreResult.clicks,
					samples
				})
			});
			const data = await res.json();
			if (data.success) {
				submitMessage = data.isNewBest
					? 'New best! Submitted.'
					: `Submitted! Best: ${data.bestScore.toLocaleString()}`;
				showSubmitDialog = false;
			} else {
				submitMessage = data.error || 'Failed to submit.';
			}
		} catch {
			submitMessage = 'Network error.';
		} finally {
			isSubmitting = false;
		}
	}

	const prevLevel = $derived(levelId > 1 ? levelId - 1 : null);
	const nextLevel = $derived(levelId < levels.length ? levelId + 1 : null);
</script>

<svelte:head>
	<title>{level ? `${level.name}` : 'Not Found'} — MacMac</title>
</svelte:head>

{#if !level}
	<div class="flex min-h-dvh items-center justify-center">
		<div class="text-center">
			<div class="mb-4 text-4xl text-white/20">?</div>
			<div class="mb-4 text-white/50">Level not found</div>
			<a href="/" class="text-sm text-game-cyan hover:underline">Back home</a>
		</div>
	</div>
{:else}
	<div class="flex h-dvh flex-col overflow-hidden">
		<!-- Top bar: nav + score -->
		<div class="flex items-center justify-between px-3 py-2">
			<div class="flex items-center gap-2">
				<a href="/" class="text-xs text-white/30 transition hover:text-white/60">MacMac</a>
				<span class="text-white/10">/</span>
				<div class="flex items-center gap-1.5">
					<span
						class="inline-block h-1.5 w-1.5 rounded-full"
						style="background-color: {getDifficultyColor(level.difficulty)}"
					></span>
					<span class="text-xs font-medium text-white/60">
						{level.id}. {level.name}
					</span>
				</div>
			</div>

			<div class="flex items-center gap-1">
				{#if prevLevel}
					<a href="/play/{prevLevel}" class="px-2 py-1 text-xs text-white/25 transition hover:text-white/60">
						←
					</a>
				{/if}
				{#if nextLevel}
					<a href="/play/{nextLevel}" class="px-2 py-1 text-xs text-white/25 transition hover:text-white/60">
						→
					</a>
				{/if}
			</div>
		</div>

		<!-- Score -->
		<div class="px-3 pb-1">
			<ScorePanel {scoreResult} par={level.par} />
		</div>

		<!-- Canvas fills remaining space -->
		<div class="min-h-0 flex-1 px-1">
			<GameCanvas {level} {samples} onSampleAdd={addSample} />
		</div>

		<!-- Bottom controls -->
		<div class="flex items-center justify-between px-3 py-2">
			<div class="flex items-center gap-1.5">
				<button
					onclick={undoLast}
					disabled={samples.length === 0}
					class="rounded px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/5 hover:text-white/60 disabled:opacity-20"
				>
					Undo
				</button>
				<button
					onclick={resetSamples}
					disabled={samples.length === 0}
					class="rounded px-3 py-1.5 text-xs text-white/40 transition hover:bg-white/5 hover:text-white/60 disabled:opacity-20"
				>
					Reset
				</button>
				<span class="ml-1 text-[10px] text-white/15">scroll to zoom · shift+drag to pan</span>
			</div>

			<div class="flex items-center gap-2">
				{#if submitMessage}
					<span class="text-[10px] text-white/40">{submitMessage}</span>
				{/if}
				<button
					onclick={openSubmit}
					disabled={samples.length < 3}
					class="rounded-md bg-game-cyan/80 px-4 py-1.5 text-xs font-semibold text-game-bg transition hover:bg-game-cyan disabled:opacity-20"
				>
					Submit
				</button>
			</div>
		</div>
	</div>

	{#if showSubmitDialog}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
			role="dialog"
			aria-modal="true"
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="mx-4 w-full max-w-xs rounded-xl bg-[#14142a] p-5 shadow-2xl"
				onkeydown={(e) => e.key === 'Escape' && (showSubmitDialog = false)}
			>
				<h3 class="mb-3 text-base font-semibold text-white">Submit Score</h3>
				<p class="mb-3 text-xs text-white/35">
					{scoreResult.score.toLocaleString()} pts · {scoreResult.clicks} clicks · KL {scoreResult.kl.toFixed(4)}
				</p>
				<input
					type="text"
					bind:value={playerName}
					maxlength="24"
					placeholder="Display name"
					class="mb-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/20 outline-none ring-1 ring-white/10 transition focus:ring-game-cyan/40"
				/>
				<div class="flex justify-end gap-2">
					<button
						onclick={() => (showSubmitDialog = false)}
						class="rounded px-3 py-1.5 text-xs text-white/40 transition hover:text-white/60"
					>
						Cancel
					</button>
					<button
						onclick={submitScore}
						disabled={!playerName.trim() || isSubmitting}
						class="rounded-md bg-game-cyan px-4 py-1.5 text-xs font-semibold text-game-bg transition hover:brightness-110 disabled:opacity-30"
					>
						{isSubmitting ? 'Saving…' : 'Submit'}
					</button>
				</div>
			</div>
		</div>
	{/if}
{/if}
