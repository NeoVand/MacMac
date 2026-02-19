<script lang="ts">
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		par: number;
	}

	let { scoreResult, par }: Props = $props();

	const klDisplay = $derived(
		scoreResult.kl === Infinity
			? '---'
			: scoreResult.kl < 0.001
				? '<.001'
				: scoreResult.kl.toFixed(3)
	);

	const accuracyPct = $derived(Math.round(scoreResult.accuracyRating * 100));

	const clickRatio = $derived(
		scoreResult.clicks === 0 ? 0 : scoreResult.clicks / par
	);

	const clickColor = $derived(
		clickRatio <= 0.8 ? '#4ade80' : clickRatio <= 1.3 ? '#fbbf24' : '#f97316'
	);
</script>

<div class="flex items-end gap-6">
	<!-- Score big -->
	<div>
		<div class="text-[10px] font-medium tracking-[0.15em] text-white/30 uppercase">Score</div>
		<div class="text-4xl font-extrabold tabular-nums leading-none text-white sm:text-5xl">
			{scoreResult.score.toLocaleString()}
		</div>
	</div>

	<!-- Stats row -->
	<div class="flex gap-4 pb-1">
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">KL</div>
			<div class="font-mono text-sm tabular-nums text-cyan-400">{klDisplay}</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">Accuracy</div>
			<div class="font-mono text-sm tabular-nums text-cyan-400">{accuracyPct}%</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">Clicks</div>
			<div class="font-mono text-sm tabular-nums" style="color: {clickColor}">
				{scoreResult.clicks}
				<span class="text-[10px] text-white/20">/{par}</span>
			</div>
		</div>
	</div>
</div>
