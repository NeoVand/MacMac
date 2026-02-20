<script lang="ts">
	import { levels } from '$lib/game/levels';
	import { getDifficultyColor } from '$lib/game/scoring';
	import AppHeader from '$lib/components/AppHeader.svelte';

	let { data } = $props();

	let selectedLevel = $state(1);
	const currentLevel = $derived(levels.find((l) => l.id === selectedLevel)!);
	const entries = $derived(data.leaderboardData[selectedLevel] || []);

	function countryFlag(code: string | null): string {
		if (!code || code.length !== 2) return '';
		return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
	}

	function formatTime(ms: number | null): string {
		if (!ms) return '—';
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>Leaderboard — macmac</title>
</svelte:head>

<div class="min-h-dvh">
	<AppHeader breadcrumb="Leaderboard" breadcrumbIcon="crown" />

	<div class="mx-auto max-w-2xl px-4 pb-12 sm:px-6">
		<!-- Level tabs -->
		<div class="mb-4 flex gap-1.5 overflow-x-auto pb-1">
			{#each levels as level}
				<button
					onclick={() => (selectedLevel = level.id)}
					class="flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition"
					style={selectedLevel === level.id
						? `background: var(--surface); border: 1px solid var(--border-hover); color: var(--text-primary);`
						: `border: 1px solid transparent; color: var(--text-tertiary);`}
				>
					<span class="h-1.5 w-1.5 rounded-full" style="background-color: {getDifficultyColor(level.difficulty)}"></span>
					<span class="hidden sm:inline">{level.name}</span>
					<span class="sm:hidden">{level.id}</span>
				</button>
			{/each}
		</div>

		<!-- Level heading -->
		<div class="mb-4 flex items-center gap-2">
			<span class="inline-block h-2 w-2 rounded-full" style="background: {getDifficultyColor(currentLevel.difficulty)}"></span>
			<h2 class="text-base font-semibold" style="color: var(--text-primary);">{currentLevel.name}</h2>
			<span class="rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize" style="background: var(--surface); color: var(--text-tertiary);">{currentLevel.difficulty}</span>
		</div>

		{#if entries.length === 0}
			<!-- Empty state -->
			<div class="rounded-2xl py-14 text-center" style="background: var(--surface);">
				<svg viewBox="0 0 24 24" fill="currentColor" class="mx-auto mb-3 h-7 w-7" style="color: var(--text-tertiary); opacity: 0.25;"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
				<div class="text-sm" style="color: var(--text-tertiary);">No scores yet</div>
				<a href="/play/{currentLevel.id}" class="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[12px] font-semibold transition hover:brightness-110" style="background: color-mix(in srgb, var(--accent-cyan) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
					Be the first
				</a>
			</div>
		{:else}
			<!-- Table -->
			<div class="overflow-x-auto">
				<table class="w-full">
					<thead>
						<tr class="text-[10px] font-medium uppercase tracking-wider" style="color: var(--text-tertiary);">
							<th class="pb-2 text-left">#</th>
							<th class="pb-2 text-left">Player</th>
							<th class="pb-2 text-right">Score</th>
							<th class="hidden pb-2 text-right sm:table-cell">Match</th>
							<th class="hidden pb-2 text-right sm:table-cell">Clicks</th>
							<th class="pb-2 text-right">Time</th>
						</tr>
					</thead>
					<tbody>
						{#each entries as entry, i}
							<tr
								class="border-t text-sm"
								style="border-color: var(--border); color: {i === 0 ? 'var(--accent-cyan)' : 'var(--text-primary)'}; opacity: {i === 0 ? 1 : i < 3 ? 0.75 : 0.5};"
							>
								<td class="py-3 pr-3 font-mono text-xs font-bold tabular-nums">{i + 1}</td>
								<td class="py-3 pr-3 font-medium">
									{#if entry.country}<span class="mr-1">{countryFlag(entry.country)}</span>{/if}{entry.playerName}
								</td>
								<td class="py-3 pr-3 text-right font-mono font-bold tabular-nums">{entry.score.toLocaleString()}</td>
								<td class="hidden py-3 pr-3 text-right font-mono text-xs tabular-nums sm:table-cell" style="color: #4ade80;">
									{Math.round((1 / (1 + 100 * entry.kl)) * 100)}%
								</td>
								<td class="hidden py-3 pr-3 text-right font-mono text-xs tabular-nums sm:table-cell" style="color: var(--accent-orange);">
									{entry.clicks}
								</td>
								<td class="py-3 text-right font-mono text-xs tabular-nums" style="color: var(--accent-purple);">
									{formatTime(entry.duration)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
