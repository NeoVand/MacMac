<script lang="ts">
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		par: number;
	}

	let { scoreResult, par }: Props = $props();

	const klDisplay = $derived(
		scoreResult.kl === Infinity ? '—' : scoreResult.kl < 0.001 ? '<0.001' : scoreResult.kl.toFixed(3)
	);

	const accuracyPercent = $derived(Math.round(scoreResult.accuracyRating * 100));

	const clickColor = $derived(
		scoreResult.clicks <= par * 0.8
			? '#4ade80'
			: scoreResult.clicks <= par * 1.2
				? '#facc15'
				: '#f97316'
	);
</script>

<div class="flex flex-wrap items-center gap-3 sm:gap-5">
	<div class="flex flex-col">
		<span class="text-[10px] uppercase tracking-widest text-white/40">Score</span>
		<span class="text-2xl font-bold tabular-nums text-white sm:text-3xl">
			{scoreResult.score.toLocaleString()}
		</span>
	</div>

	<div class="h-8 w-px bg-white/10"></div>

	<div class="flex flex-col">
		<span class="text-[10px] uppercase tracking-widest text-white/40">KL Divergence</span>
		<span class="font-mono text-sm tabular-nums text-cyan-400">{klDisplay}</span>
	</div>

	<div class="flex flex-col">
		<span class="text-[10px] uppercase tracking-widest text-white/40">Accuracy</span>
		<span class="font-mono text-sm tabular-nums text-cyan-400">{accuracyPercent}%</span>
	</div>

	<div class="flex flex-col">
		<span class="text-[10px] uppercase tracking-widest text-white/40">Clicks</span>
		<span class="font-mono text-sm tabular-nums" style="color: {clickColor}">
			{scoreResult.clicks}
			<span class="text-white/30">/ {par} par</span>
		</span>
	</div>
</div>
