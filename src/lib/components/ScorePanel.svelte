<script lang="ts">
	import { onMount } from 'svelte';
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		topScore: number;
	}

	let { scoreResult, topScore }: Props = $props();

	let displayScore = $state(0);
	let animHandle = 0;
	let mounted = $state(false);

	const isLeader = $derived(topScore > 0 && scoreResult.score > topScore);

	const klDisplay = $derived(
		scoreResult.kl === Infinity ? '---' : scoreResult.kl < 0.001 ? '<.001' : scoreResult.kl.toFixed(3)
	);

	onMount(() => {
		mounted = true;
		let running = true;
		function tick() {
			if (!running) return;
			const target = scoreResult.score;
			const diff = target - displayScore;
			if (Math.abs(diff) < 1) {
				displayScore = target;
			} else {
				displayScore += diff * 0.15;
			}
			animHandle = requestAnimationFrame(tick);
		}
		tick();
		return () => { running = false; cancelAnimationFrame(animHandle); };
	});

	$effect(() => {
		if (!mounted) displayScore = scoreResult.score;
	});
</script>

<div class="flex items-end gap-5">
	<div>
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] font-medium tracking-[0.15em] text-white/30 uppercase">Score</span>
			{#if isLeader}
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 text-yellow-400">
					<path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" />
				</svg>
			{/if}
		</div>
		<div
			class="text-4xl font-extrabold tabular-nums leading-none transition-colors duration-300 sm:text-5xl"
			class:text-white={!isLeader}
			class:text-yellow-400={isLeader}
		>
			{Math.round(displayScore).toLocaleString()}
		</div>
	</div>

	<div class="flex gap-4 pb-1">
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">KL</div>
			<div class="font-mono text-sm tabular-nums text-cyan-400">{klDisplay}</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">Accuracy</div>
			<div class="font-mono text-sm tabular-nums text-cyan-400">{scoreResult.accuracyPct}%</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest text-white/25 uppercase">Clicks</div>
			<div class="font-mono text-sm tabular-nums text-white/50">{scoreResult.clicks}</div>
		</div>
	</div>
</div>
