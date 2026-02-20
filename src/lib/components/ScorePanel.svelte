<script lang="ts">
	import { onMount } from 'svelte';
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		topScore: number;
		elapsedMs: number;
	}

	let { scoreResult, topScore, elapsedMs }: Props = $props();

	let dScore = $state(0);
	let dKl = $state(0);
	let dAccuracy = $state(0);
	let dClicks = $state(0);
	let mounted = $state(false);

	const isLeader = $derived(topScore > 0 && scoreResult.score > topScore);

	const timerDisplay = $derived(() => {
		const totalSec = Math.floor(elapsedMs / 1000);
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	});

	const klTarget = $derived(scoreResult.kl === Infinity ? 0 : scoreResult.kl);

	onMount(() => {
		mounted = true;
		let running = true;
		function tick() {
			if (!running) return;
			dScore += (scoreResult.score - dScore) * 0.15;
			dKl += (klTarget - dKl) * 0.15;
			dAccuracy += (scoreResult.accuracyPct - dAccuracy) * 0.15;
			dClicks += (scoreResult.clicks - dClicks) * 0.15;
			if (Math.abs(dScore - scoreResult.score) < 1) dScore = scoreResult.score;
			if (Math.abs(dKl - klTarget) < 0.0005) dKl = klTarget;
			if (Math.abs(dAccuracy - scoreResult.accuracyPct) < 0.5) dAccuracy = scoreResult.accuracyPct;
			if (Math.abs(dClicks - scoreResult.clicks) < 0.5) dClicks = scoreResult.clicks;
			requestAnimationFrame(tick);
		}
		tick();
		return () => { running = false; };
	});

	$effect(() => {
		if (!mounted) {
			dScore = scoreResult.score;
			dKl = klTarget;
			dAccuracy = scoreResult.accuracyPct;
			dClicks = scoreResult.clicks;
		}
	});
</script>

<div class="flex flex-wrap items-end gap-x-5 gap-y-1">
	<!-- Score -->
	<div>
		<div class="flex items-center gap-1.5">
			<span class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Score</span>
			{#if isLeader}
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-3 w-3 text-yellow-500"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
			{/if}
		</div>
		<div class="text-3xl font-extrabold tabular-nums leading-none sm:text-4xl" style="color: {isLeader ? '#eab308' : 'var(--text-primary)'};">
			{Math.round(dScore).toLocaleString()}
		</div>
	</div>

	<!-- KL -->
	<div>
		<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">KL</div>
		<div class="text-xl font-bold tabular-nums leading-none sm:text-2xl" style="color: var(--accent-cyan);">
			{scoreResult.kl === Infinity ? '---' : dKl < 0.001 ? '<.001' : dKl.toFixed(3)}
		</div>
	</div>

	<!-- Accuracy -->
	<div>
		<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Accuracy</div>
		<div class="text-xl font-bold tabular-nums leading-none sm:text-2xl" style="color: #4ade80;">
			{Math.round(dAccuracy)}%
		</div>
	</div>

	<!-- Clicks -->
	<div>
		<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Clicks</div>
		<div class="text-xl font-bold tabular-nums leading-none sm:text-2xl" style="color: var(--accent-orange);">
			{Math.round(dClicks)}
		</div>
	</div>

	<!-- Timer -->
	<div>
		<div class="text-[9px] font-medium tracking-[0.15em] uppercase" style="color: var(--text-tertiary);">Time</div>
		<div class="text-xl font-bold tabular-nums leading-none sm:text-2xl" style="color: var(--accent-purple);">
			{timerDisplay()}
		</div>
	</div>
</div>
