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
			const diff = scoreResult.score - displayScore;
			if (Math.abs(diff) < 1) displayScore = scoreResult.score;
			else displayScore += diff * 0.15;
			animHandle = requestAnimationFrame(tick);
		}
		tick();
		return () => { running = false; cancelAnimationFrame(animHandle); };
	});

	$effect(() => { if (!mounted) displayScore = scoreResult.score; });
</script>

<div class="flex items-end gap-5">
	<div>
		<div class="flex items-center gap-1.5">
			<span class="text-[10px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Score</span>
			{#if isLeader}
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 text-yellow-500"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
			{/if}
		</div>
		<div
			class="text-4xl font-extrabold tabular-nums leading-none sm:text-5xl"
			style="color: {isLeader ? '#eab308' : 'var(--text-primary)'};"
		>
			{Math.round(displayScore).toLocaleString()}
		</div>
	</div>

	<div class="flex gap-4 pb-1">
		<div>
			<div class="text-[9px] tracking-widest uppercase" style="color: var(--text-tertiary);">KL</div>
			<div class="font-mono text-sm tabular-nums" style="color: var(--accent-cyan);">{klDisplay}</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest uppercase" style="color: var(--text-tertiary);">Accuracy</div>
			<div class="font-mono text-sm tabular-nums" style="color: var(--accent-cyan);">{scoreResult.accuracyPct}%</div>
		</div>
		<div>
			<div class="text-[9px] tracking-widest uppercase" style="color: var(--text-tertiary);">Clicks</div>
			<div class="font-mono text-sm tabular-nums" style="color: var(--text-secondary);">{scoreResult.clicks}</div>
		</div>
	</div>
</div>
