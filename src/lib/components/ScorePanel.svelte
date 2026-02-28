<script lang="ts">
	import { onMount } from 'svelte';
	import type { ScoreResult } from '$lib/game/scoring';
	type TopRank = 1 | 2 | 3 | null;

	interface Props {
		scoreResult: ScoreResult;
		scoreRank: TopRank;
		elapsedMs: number;
		difficultyMultiplier?: number;
	}

	let { scoreResult, scoreRank, elapsedMs, difficultyMultiplier = 1 }: Props = $props();

	let dScore = $state(0);
	let dMatch = $state(0);
	let dClicks = $state(0);

	const displayScore = $derived(Math.round(scoreResult.score * difficultyMultiplier));

	const isTopThree = $derived(scoreRank !== null);
	const rankColor = $derived.by(() => {
		switch (scoreRank) {
			case 1:
				return '#eab308'; // gold
			case 2:
				return '#a8b4c4'; // silver
			case 3:
				return '#a56a43'; // bronze
			default:
				return 'var(--text-primary)';
		}
	});

	const timerDisplay = $derived.by(() => {
		const totalSec = Math.floor(elapsedMs / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	});

	onMount(() => {
		dScore = displayScore;
		dMatch = scoreResult.matchPct;
		dClicks = scoreResult.clicks;

		let running = true;
		function tick() {
			if (!running) return;
			dScore += (displayScore - dScore) * 0.15;
			dMatch += (scoreResult.matchPct - dMatch) * 0.15;
			dClicks += (scoreResult.clicks - dClicks) * 0.15;
			if (Math.abs(dScore - displayScore) < 1) dScore = displayScore;
			if (Math.abs(dMatch - scoreResult.matchPct) < 0.5) dMatch = scoreResult.matchPct;
			if (Math.abs(dClicks - scoreResult.clicks) < 0.5) dClicks = scoreResult.clicks;
			requestAnimationFrame(tick);
		}
		tick();
		return () => { running = false; };
	});
</script>

<div class="flex items-end gap-4">
	<!-- Score (prominent) -->
	<div class="min-w-0 shrink-0">
		<div class="flex items-center gap-1.5">
			<span class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Score</span>
			{#if isTopThree}
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-3 w-3" style="color: {rankColor};"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
			{/if}
		</div>
		<div class="text-3xl font-extrabold tabular-nums leading-none sm:text-4xl" style="color: {rankColor};">
			{Math.round(dScore).toLocaleString()}
		</div>
	</div>

	<!-- Secondary stats: Match, Clicks, Time -->
	<div class="flex min-w-0 gap-4">
		<div>
			<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Match</div>
			<div class="text-lg font-bold tabular-nums leading-none sm:text-xl" style="color: #4ade80;">
				{Math.round(dMatch)}%
			</div>
		</div>

		<div>
			<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Clicks</div>
			<div class="text-lg font-bold tabular-nums leading-none sm:text-xl" style="color: var(--accent-orange);">
				{Math.round(dClicks)}
			</div>
		</div>

		<div>
			<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Time</div>
			<div class="text-lg font-bold tabular-nums leading-none sm:text-xl" style="color: var(--accent-cyan);">
				{timerDisplay}
			</div>
		</div>
	</div>
</div>
