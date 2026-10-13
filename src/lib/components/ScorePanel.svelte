<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import type { ScoreResult } from '$lib/game/scoring';

	interface Props {
		scoreResult: ScoreResult;
		elapsedMs: number;
		difficultyMultiplier?: number;
		showTime?: boolean;
	}

	let { scoreResult, elapsedMs, difficultyMultiplier = 1, showTime = true }: Props = $props();

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

<div class="score-panel">
	<div class="score-main">
		<span>Score</span><strong>{Math.round(dScore.current).toLocaleString()}</strong>
	</div>
	<dl class="score-readouts">
		<div class="match-readout">
			<dt>Match</dt>
			<dd>{Math.round(dMatch.current)}<span>%</span></dd>
		</div>
		<div class="click-readout">
			<dt>Clicks</dt>
			<dd>{Math.round(dClicks.current)}</dd>
		</div>
		{#if showTime}
			<div class="time-readout">
				<dt>Time</dt>
				<dd>{timerDisplay}</dd>
			</div>
		{/if}
	</dl>
</div>

<style>
	.score-panel {
		display: flex;
		align-items: center;
		gap: 24px;
		min-width: 0;
		font-family: var(--font-body);
	}
	.score-main {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		padding-right: 0;
	}
	.score-main > span,
	dt {
		font-size: 10px;
		color: var(--text-secondary);
		font-weight: 500;
		line-height: 1.2;
	}
	.score-main strong {
		font-family: var(--font-display);
		color: var(--text-primary);
		font-size: 34px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		letter-spacing: -0.05em;
	}
	.score-readouts {
		display: flex;
		gap: 22px;
		align-items: center;
	}
	.score-readouts > div {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	dd {
		font-family: var(--font-display);
		font-size: 21px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.035em;
		line-height: 1.1;
	}
	dd span {
		font-size: 0.72em;
		padding-left: 1px;
	}
	.match-readout dd {
		color: var(--accent-cyan);
	}
	.click-readout dd {
		color: var(--accent-orange);
	}
	.time-readout dd {
		color: var(--text-primary);
	}
	@media (max-width: 700px) {
		.score-panel {
			gap: 16px;
		}
		.score-main {
			padding-right: 0;
		}
		.score-readouts {
			gap: 17px;
		}
		.score-main strong {
			font-size: 29px;
		}
		dd {
			font-size: 19px;
		}
	}
	@media (max-width: 420px) {
		.score-panel {
			gap: 12px;
		}
		.score-main {
			padding-right: 0;
			gap: 5px;
		}
		.score-readouts {
			gap: 13px;
		}
		.score-readouts > div {
			gap: 6px;
		}
		.score-main strong {
			font-size: 26px;
		}
		dd {
			font-size: 17px;
		}
		dt,
		.score-main > span {
			font-size: 9px;
		}
	}
</style>
