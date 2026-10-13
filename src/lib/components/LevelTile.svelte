<script lang="ts">
	import { resolve } from '$app/paths';
	import type { GeneratedLevel } from '$lib/game/generator';
	import { linspace } from '$lib/game/math';
	import { difficultyColor, difficultyToLabel } from '$lib/game/difficulty';

	let { level }: { level: GeneratedLevel } = $props();
	const uid = $props.id();
	const FAMILY_SCALES = [0.16, 0.25, 0.34, 0.43, 0.52, 0.61, 0.7, 0.79, 0.88, 1];
	const DOTS = [0, 1, 2, 3, 4];
	const difficulty = $derived(level.targetDifficulty);
	const color = $derived(difficultyColor(difficulty));
	const label = $derived(difficultyToLabel(difficulty));
	const description = $derived(
		`Play ${level.name}, ${label} difficulty, ${difficulty.toFixed(1)} out of 10, 30-second challenge`
	);
	const family = $derived.by(() => {
		const xs = linspace(level.xRange[0], level.xRange[1], 80);
		const values = xs.map((x) => level.pdf(x));
		const peak = Math.max(...values) * 1.1 || 1;
		return FAMILY_SCALES.map((scale) => ({
			scale,
			path: values
				.map(
					(value, index) =>
						`${index === 0 ? 'M' : 'L'}${(4 + (index / (values.length - 1)) * 152).toFixed(1)},${(44 - ((value * scale) / peak) * 40).toFixed(1)}`
				)
				.join('')
		}));
	});
</script>

<a
	href={resolve('/play/[level]', { level: String(level.id) })}
	class="level-tile"
	aria-label={description}
	title={description}
	style:--tile-color={color}
>
	<svg class="curve-thumbnail" viewBox="0 0 160 48" preserveAspectRatio="none" aria-hidden="true">
		<defs>
			<linearGradient
				id="{uid}-contours"
				x1="0"
				y1="0"
				x2="160"
				y2="0"
				gradientUnits="userSpaceOnUse"
			>
				<stop offset="0%" stop-color="var(--accent-cyan)" />
				<stop offset="100%" stop-color="var(--accent-purple)" />
			</linearGradient>
		</defs>
		{#each family as { path, scale } (scale)}
			{#if scale === 1}<path
					d="{path}L156,44L4,44Z"
					fill="url(#{uid}-contours)"
					opacity="0.06"
				/>{/if}
			<path
				d={path}
				fill="none"
				stroke="url(#{uid}-contours)"
				stroke-width={scale === 1 ? 1.4 : 0.65}
				opacity={scale === 1 ? 0.92 : 0.16 + scale * 0.4}
				vector-effect="non-scaling-stroke"
			/>
		{/each}
	</svg>
	<span class="difficulty-details" aria-hidden="true">
		<svg class="difficulty-dots" viewBox="0 0 38 6">
			{#each DOTS as dot (dot)}
				{@const remaining = difficulty / 2 - dot}
				{@const full = remaining >= 0.75}
				{@const half = !full && remaining >= 0.25}
				<circle cx={3 + dot * 8} cy="3" r="2.5" fill={color} opacity={full ? 0.9 : 0.16} />
				{#if half}<path
						d="M{3 + dot * 8},0.5A2.5,2.5 0 0 0 {3 + dot * 8},5.5Z"
						fill={color}
						opacity="0.9"
					/>{/if}
			{/each}
		</svg>
		<span class="difficulty-value">{difficulty.toFixed(1)}</span>
	</span>
</a>

<style>
	.level-tile {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: stretch;
		gap: 6px;
		min-width: 0;
		min-height: 82px;
		padding: 10px 12px;
		border-radius: 12px;
		background: color-mix(in srgb, var(--surface) 65%, transparent);
		text-decoration: none;
		transition:
			background-color 150ms ease,
			box-shadow 150ms ease;
	}
	.level-tile:hover {
		background: var(--surface);
		box-shadow: 0 0 15px color-mix(in srgb, var(--tile-color) 9%, transparent);
	}
	.level-tile:focus-visible {
		outline: 2px solid var(--accent-cyan);
		outline-offset: 3px;
	}
	.curve-thumbnail {
		display: block;
		width: 100%;
		height: 42px;
	}
	.difficulty-details {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 12px;
	}
	.difficulty-dots {
		width: 40px;
		height: 7px;
		flex-shrink: 0;
	}
	.difficulty-value {
		font-size: 10px;
		line-height: 1.2;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	@media (max-width: 640px) {
		.level-tile {
			padding: 10px 8px;
			min-height: 80px;
			gap: 5px;
		}
		.curve-thumbnail {
			height: 40px;
		}
		.difficulty-value {
			font-size: 9px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.level-tile {
			transition: none;
		}
	}
</style>
