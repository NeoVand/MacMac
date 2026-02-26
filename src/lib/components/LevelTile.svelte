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
	class="group overflow-hidden rounded-2xl p-2.5 transition hover:opacity-80"
	style="background: var(--surface);"
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

	<div class="flex items-center gap-1.5">
		<span
			class="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
			style="background-color: {dColor};"
		></span>
		<span class="text-[11px] font-semibold tabular-nums" style="color: {dColor}; opacity: 0.8;">
			{level.targetDifficulty.toFixed(1)}
		</span>
	</div>
</a>
