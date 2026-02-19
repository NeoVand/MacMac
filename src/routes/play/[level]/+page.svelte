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
			submitMessage = 'Place at least 3 samples first';
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
				? localStorage.getItem('macmac_player_id')
				: null;
			if (!playerId) {
				playerId = crypto.randomUUID();
				if (typeof localStorage !== 'undefined')
					localStorage.setItem('macmac_player_id', playerId);
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
	<div class="relative h-dvh w-full overflow-hidden bg-game-bg">
		<!-- Full-screen canvas -->
		<div class="absolute inset-0">
			<GameCanvas {level} {samples} onSampleAdd={addSample} />
		</div>

		<!-- Top overlay: level info + score -->
		<div class="pointer-events-none absolute inset-x-0 top-0 z-10">
			<div class="bg-gradient-to-b from-black/50 via-black/25 to-transparent px-5 pb-8 pt-4">
				<!-- Nav row -->
				<div class="pointer-events-auto mb-3 flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						<a
							href="/"
							class="rounded-full bg-white/5 px-3 py-1 text-xs font-medium text-white/50 backdrop-blur-sm transition hover:bg-white/10 hover:text-white/80"
						>
							MacMac
						</a>
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
								class="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 backdrop-blur-sm transition hover:bg-white/10 hover:text-white/70"
								aria-label="Previous level"
							>
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
									<path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" />
								</svg>
							</a>
						{/if}
						{#if nextLevel}
							<a
								href="/play/{nextLevel}"
								class="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 backdrop-blur-sm transition hover:bg-white/10 hover:text-white/70"
								aria-label="Next level"
							>
								<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
									<path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
								</svg>
							</a>
						{/if}
						<a
							href="/leaderboard"
							class="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 backdrop-blur-sm transition hover:bg-white/10 hover:text-white/70"
							aria-label="Leaderboard"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
								<path fill-rule="evenodd" d="M10 2a.75.75 0 01.75.75v.258a33.186 33.186 0 016.668.83.75.75 0 01-.336 1.461 31.28 31.28 0 00-1.103-.232l1.702 7.545a.75.75 0 01-.387.832A4.981 4.981 0 0115 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.77-7.849a31.743 31.743 0 00-3.339-.254v11.505a20.01 20.01 0 013.78.501.75.75 0 11-.339 1.462A18.558 18.558 0 0010 17.5a18.558 18.558 0 00-4.191.477.75.75 0 01-.339-1.462 20.01 20.01 0 013.78-.501V4.509c-1.129.026-2.243.112-3.34.254l1.771 7.85a.75.75 0 01-.387.83A4.981 4.981 0 015 14a4.981 4.981 0 01-2.294-.556.75.75 0 01-.387-.832l1.702-7.545c-.37.07-.738.148-1.103.232a.75.75 0 01-.336-1.462 33.053 33.053 0 016.668-.829V2.75A.75.75 0 0110 2zM5 12.662l-1.395-6.177C4.6 7.273 5.596 8 5.75 8c.154 0 1.15-.727 2.145-1.515L6.5 12.662A3.475 3.475 0 015 13c-.53 0-1.037-.118-1.5-.338zm10 0l-1.395-6.177C14.6 7.273 15.596 8 15.75 8c.154 0 1.15-.727 2.145-1.515L16.5 12.662a3.475 3.475 0 01-1.5.338c-.53 0-1.037-.118-1.5-.338z" clip-rule="evenodd" />
							</svg>
						</a>
					</div>
				</div>

				<!-- Score -->
				<div class="pointer-events-auto">
					<ScorePanel {scoreResult} par={level.par} />
				</div>
			</div>
		</div>

		<!-- Bottom overlay: action buttons -->
		<div class="pointer-events-none absolute inset-x-0 bottom-0 z-10">
			<div class="bg-gradient-to-t from-black/60 via-black/30 to-transparent px-5 pb-5 pt-12">
				{#if submitMessage}
					<div class="pointer-events-auto mb-3 text-center text-sm font-medium text-game-cyan">
						{submitMessage}
					</div>
				{/if}

				<div class="pointer-events-auto flex items-center justify-between">
					<!-- Left: undo / reset -->
					<div class="flex gap-2">
						<button
							onclick={undoLast}
							disabled={samples.length === 0}
							class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-sm font-medium text-white/60 backdrop-blur-sm transition hover:bg-white/[0.12] hover:text-white/90 disabled:opacity-20"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
								<path fill-rule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clip-rule="evenodd" />
							</svg>
							Undo
						</button>
						<button
							onclick={resetSamples}
							disabled={samples.length === 0}
							class="flex h-11 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-sm font-medium text-white/60 backdrop-blur-sm transition hover:bg-white/[0.12] hover:text-white/90 disabled:opacity-20"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
								<path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.451a.75.75 0 000-1.5H4.5a.75.75 0 00-.75.75v3.75a.75.75 0 001.5 0v-2.033l.364.363a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm-10.624-2.85a5.5 5.5 0 019.201-2.466l.312.311H11.75a.75.75 0 000 1.5H15.5a.75.75 0 00.75-.75V3.42a.75.75 0 00-1.5 0v2.033l-.364-.363A7 7 0 002.674 8.228a.75.75 0 001.449.39z" clip-rule="evenodd" />
							</svg>
							Reset
						</button>
					</div>

					<!-- Right: zoom + submit -->
					<div class="flex items-center gap-2">
						<button
							onclick={openSubmit}
							disabled={samples.length < 3}
							class="flex h-11 items-center gap-2 rounded-xl bg-game-cyan px-6 text-sm font-bold text-game-bg transition hover:scale-105 hover:brightness-110 active:scale-95 disabled:opacity-20 disabled:hover:scale-100"
						>
							<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4">
								<path fill-rule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clip-rule="evenodd" />
							</svg>
							Submit
						</button>
					</div>
				</div>

				<!-- Hint -->
				<div class="mt-2 text-center text-[10px] text-white/15">
					click anywhere to sample · scroll to zoom · shift+drag to pan
				</div>
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
					{scoreResult.score.toLocaleString()} pts · {scoreResult.clicks} clicks · KL {scoreResult.kl === Infinity ? '---' : scoreResult.kl.toFixed(4)}
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
						class="flex-1 rounded-xl bg-white/5 py-2.5 text-sm font-medium text-white/40 transition hover:bg-white/10 hover:text-white/60"
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
