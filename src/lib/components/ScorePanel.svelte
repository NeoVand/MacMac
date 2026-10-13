<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		elapsedMs: number;
		difficultyMultiplier?: number;
	}

	let { scoreResult, elapsedMs, difficultyMultiplier = 1 }: Props = $props();

	const displayScore = $derived(Math.round(scoreResult.score * difficultyMultiplier));
	const animation = { duration: () => (prefersReducedMotion.current ? 0 : 180) };
	const dScore = Tween.of(() => displayScore, animation);
	const dMatch = Tween.of(() => scoreResult.matchPct, animation);
	const dClicks = Tween.of(() => scoreResult.clicks, animation);

	const timerDisplay = $derived.by(() => {
		const totalSec = Math.floor(elapsedMs / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	});
</script>

<div class="flex items-end gap-3 sm:gap-4">
	<!-- Score (prominent) -->
	<div class="min-w-0 shrink-0">
		<div class="text-[10px] font-medium" style="color: var(--text-secondary);">Score</div>
		<div
			class="text-3xl leading-none font-extrabold tabular-nums sm:text-4xl"
			style="color: var(--text-primary);"
		>
			{Math.round(dScore.current).toLocaleString()}
		</div>
	</div>

	<!-- Secondary stats: Match, Clicks, Time -->
	<div class="flex min-w-0 gap-3 sm:gap-4">
		<div>
			<div class="text-[10px] font-medium" style="color: var(--text-secondary);">Match</div>
			<div
				class="text-lg leading-none font-bold tabular-nums sm:text-xl"
				style="color: var(--win-green);"
			>
				{Math.round(dMatch.current)}%
			</div>
		</div>

		<div>
			<div class="text-[10px] font-medium" style="color: var(--text-secondary);">Clicks</div>
			<div
				class="text-lg leading-none font-bold tabular-nums sm:text-xl"
				style="color: var(--accent-orange);"
			>
				{Math.round(dClicks.current)}
			</div>
		</div>

		<div>
			<div class="text-[10px] font-medium" style="color: var(--text-secondary);">Time</div>
			<div
				class="text-lg leading-none font-bold tabular-nums sm:text-xl"
				style="color: var(--accent-cyan);"
			>
				{timerDisplay}
			</div>
		</div>
	</div>
</div>
