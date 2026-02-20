<script lang="ts">
	import { levels } from '$lib/game/levels';
	import { getDifficultyColor } from '$lib/game/scoring';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { data } = $props();

	let selectedLevel = $state(1);
	const currentLevel = $derived(levels.find((l) => l.id === selectedLevel)!);
	const entries = $derived(data.leaderboardData[selectedLevel] || []);
</script>

<svelte:head>
	<title>Leaderboard — macmac</title>
</svelte:head>

<div class="mx-auto min-h-dvh max-w-2xl px-6 py-8 sm:px-10">
	<div class="mb-8 flex items-center justify-between">
		<div>
			<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
				<span class="text-sm" style="color: var(--text-secondary);">mac</span><span class="text-sm" style="color: var(--accent-cyan); opacity: 0.6;">mac</span>
			</a>
			<h1 class="mt-1.5 flex items-center gap-2 text-xl font-bold" style="color: var(--text-primary);">
				<svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5 text-yellow-500" style="opacity: 0.7;"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
				Leaderboard
			</h1>
		</div>
		<div class="flex items-center gap-3">
			<a href="/play/1" class="flex h-10 items-center gap-2 rounded-lg px-5 text-[13px] font-semibold transition hover:opacity-80" style="background: color-mix(in srgb, var(--accent-cyan) 12%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
				Play
			</a>
			<ThemeToggle />
			<UserAvatar size="sm" />
		</div>
	</div>

	<div class="mb-6 flex gap-1 overflow-x-auto pb-2">
		{#each levels as level}
			<button
				onclick={() => (selectedLevel = level.id)}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition"
				style={selectedLevel === level.id
					? `background: var(--surface); color: var(--text-primary);`
					: `color: var(--text-secondary);`}
			>
				<span class="h-1.5 w-1.5 rounded-full" style="background-color: {getDifficultyColor(level.difficulty)}"></span>
				<span class="hidden sm:inline">{level.name}</span>
				<span class="sm:hidden">L{level.id}</span>
			</button>
		{/each}
	</div>

	<div class="mb-4 flex items-center gap-3">
		<h2 class="text-lg font-semibold" style="color: var(--text-primary); opacity: 0.8;">{currentLevel.name}</h2>
		<span class="text-xs capitalize" style="color: var(--text-tertiary);">{currentLevel.difficulty}</span>
	</div>

	{#if entries.length === 0}
		<div class="rounded-xl py-16 text-center" style="background: var(--surface);">
			<div class="mb-2 text-2xl" style="color: var(--text-tertiary);">---</div>
			<div class="text-sm" style="color: var(--text-secondary);">No scores yet for this level.</div>
			<a href="/play/{currentLevel.id}" class="mt-3 inline-block text-sm transition hover:opacity-80" style="color: var(--accent-cyan);">Be the first</a>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] tracking-wider uppercase" style="color: var(--text-tertiary);">
						<th class="pb-3 pr-4">#</th>
						<th class="pb-3 pr-4">Player</th>
						<th class="pb-3 pr-4 text-right">Score</th>
						<th class="pb-3 pr-4 text-right">KL</th>
						<th class="pb-3 text-right">Clicks</th>
					</tr>
				</thead>
				<tbody>
					{#each entries as entry, i}
						<tr style="color: {i === 0 ? 'var(--accent-cyan)' : i < 3 ? 'var(--text-secondary)' : 'var(--text-tertiary)'};">
							<td class="py-2.5 pr-4 font-mono text-xs tabular-nums">{i + 1}</td>
							<td class="py-2.5 pr-4 font-medium">{entry.playerName}</td>
							<td class="py-2.5 pr-4 text-right font-mono tabular-nums">{entry.score.toLocaleString()}</td>
							<td class="py-2.5 pr-4 text-right font-mono text-xs tabular-nums">{entry.kl < 0.001 ? '<.001' : entry.kl.toFixed(3)}</td>
							<td class="py-2.5 text-right font-mono text-xs tabular-nums">{entry.clicks}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
