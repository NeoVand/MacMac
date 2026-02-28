<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeneratedLevel } from '$lib/game/generator';
	import { linspace } from '$lib/game/math';
	import { difficultyColor } from '$lib/game/difficulty';

	let { level, delay = 0 }: { level: GeneratedLevel; delay?: number } = $props();

	let reveal = $state(0);
	let started = $state(false);

	const FAMILY_SCALES = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0];

	function svgPaths(w: number, h: number): { path: string; scale: number }[] {
		const pad = 4;
		const xs = linspace(level.xRange[0], level.xRange[1], 60);
		const vals = xs.map((x) => level.pdf(x));
		const yMax = Math.max(...vals) * 1.1 || 1;

		return FAMILY_SCALES.map((s) => {
			const pts = xs.map((x, i) => {
				const sx = pad + ((x - level.xRange[0]) / (level.xRange[1] - level.xRange[0])) * (w - pad * 2);
				const sy = pad + (h - pad * 2) - ((vals[i] * s) / yMax) * (h - pad * 2);
				return `${sx.toFixed(1)},${sy.toFixed(1)}`;
			});
			return { path: `M${pts.join('L')}`, scale: s };
		});
	}

	const family = $derived(svgPaths(160, 48));
	const dColor = $derived(difficultyColor(level.targetDifficulty));
	const diff = $derived(level.targetDifficulty);

	onMount(() => {
		const timer = setTimeout(() => {
			started = true;
			let frame: number;
			function animate() {
				reveal += (1 - reveal) * 0.08;
				if (reveal > 0.99) {
					reveal = 1;
					return;
				}
				frame = requestAnimationFrame(animate);
			}
			frame = requestAnimationFrame(animate);
			return () => cancelAnimationFrame(frame);
		}, delay);
		return () => clearTimeout(timer);
	});
</script>

<a
	href="/play/{level.id}"
	class="level-tile group overflow-hidden rounded-2xl p-2.5"
	style="background: var(--surface); --tile-glow: {dColor};"
>
	<svg
		viewBox="0 0 160 48"
		class="mb-1 w-full transition"
		style="opacity: {started ? 0.4 + reveal * 0.3 : 0};"
	>
		<defs>
			<linearGradient id="gt{level.seed}" x1="0" y1="0" x2="160" y2="0" gradientUnits="userSpaceOnUse">
				<stop offset="0%" stop-color="var(--accent-cyan)" />
				<stop offset="100%" stop-color="var(--accent-purple)" />
			</linearGradient>
		</defs>
		{#each family as { path, scale }, i}
			{@const isMain = i === family.length - 1}
			{@const scaleY = started ? reveal : 0}
			{#if isMain}
				<path
					d="{path}L160,48L0,48Z"
					fill="url(#gt{level.seed})"
					opacity={0.08 * scaleY}
					transform="translate(0,{48 * (1 - scaleY)}) scale(1,{scaleY})"
					transform-origin="0 48"
				/>
			{/if}
			<path
				d={path}
				fill="none"
				stroke="url(#gt{level.seed})"
				stroke-width={isMain ? 1.5 : 0.7}
				opacity={(isMain ? 1 : 0.15 + scale * 0.4) * scaleY}
				transform="translate(0,{48 * (1 - scaleY)}) scale(1,{scaleY})"
				transform-origin="0 48"
			/>
		{/each}
	</svg>

	<svg viewBox="0 0 38 6" class="mx-auto h-2 w-auto" aria-label="Difficulty {diff.toFixed(1)} out of 10">
		<defs>
			<clipPath id="half-{level.seed}" clipPathUnits="objectBoundingBox">
				<rect x="0" y="0" width="0.5" height="1" />
			</clipPath>
		</defs>
		{#each [0, 1, 2, 3, 4] as i}
			{@const remaining = diff / 2 - i}
			{@const full = remaining >= 0.75}
			{@const half = !full && remaining >= 0.25}
			<circle cx={3 + i * 8} cy="3" r="2.5" fill={dColor} opacity={full ? 1 : 0.2} />
			{#if half}
				<circle cx={3 + i * 8} cy="3" r="2.5" fill={dColor} clip-path="url(#half-{level.seed})" />
			{/if}
		{/each}
	</svg>
</a>
