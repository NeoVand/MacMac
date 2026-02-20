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
		if (!ms) return '---';
		const s = Math.floor(ms / 1000);
		return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>Leaderboard — macmac</title>
</svelte:head>

<div class="min-h-dvh">
	<AppHeader breadcrumb="Leaderboard" breadcrumbIcon="crown" />
	<div class="mx-auto max-w-3xl px-4 sm:px-6">

	<!-- Level tabs -->
	<div class="mb-5 flex gap-1.5 overflow-x-auto pb-1">
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

	<!-- Level name + difficulty -->
	<div class="mb-4 flex items-center gap-2">
		<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {getDifficultyColor(currentLevel.difficulty)}"></span>
		<h2 class="text-base font-semibold" style="color: var(--text-primary);">{currentLevel.name}</h2>
		<span class="rounded-lg px-2 py-0.5 text-[10px] font-medium capitalize" style="background: var(--surface); color: var(--text-tertiary);">{currentLevel.difficulty}</span>
	</div>

	<!-- Empty state -->
	{#if entries.length === 0}
		<div class="rounded-2xl py-14 text-center" style="background: var(--surface);">
			<svg viewBox="0 0 24 24" fill="currentColor" class="mx-auto mb-3 h-8 w-8" style="color: var(--text-tertiary); opacity: 0.3;"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
			<div class="text-sm" style="color: var(--text-secondary);">No scores yet</div>
			<a href="/play/{currentLevel.id}" class="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[12px] font-semibold transition hover:brightness-110" style="background: color-mix(in srgb, var(--accent-cyan) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
				Be the first
			</a>
		</div>
	{:else}
		<!-- Scores -->
		<div class="space-y-1.5">
			{#each entries as entry, i}
				<div
					class="flex items-center gap-3 rounded-xl px-4 py-2.5 transition"
					style="background: {i === 0 ? 'color-mix(in srgb, var(--accent-cyan) 6%, var(--surface))' : 'var(--surface)'}; border: 1px solid {i === 0 ? 'color-mix(in srgb, var(--accent-cyan) 15%, transparent)' : 'transparent'};"
				>
					<!-- Rank -->
					<div class="w-7 shrink-0 text-center font-mono text-sm font-bold tabular-nums" style="color: {i === 0 ? 'var(--accent-cyan)' : i < 3 ? 'var(--text-secondary)' : 'var(--text-tertiary)'};">
						{i + 1}
					</div>

					<!-- Player -->
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm font-medium" style="color: {i === 0 ? 'var(--accent-cyan)' : 'var(--text-primary)'}; opacity: {i === 0 ? 1 : 0.7};">
							{#if entry.country}<span class="mr-1">{countryFlag(entry.country)}</span>{/if}{entry.playerName}
						</div>
					</div>

					<!-- Score -->
					<div class="shrink-0 text-right">
						<div class="font-mono text-sm font-bold tabular-nums" style="color: {i === 0 ? 'var(--accent-cyan)' : 'var(--text-primary)'}; opacity: {i === 0 ? 1 : 0.7};">
							{entry.score.toLocaleString()}
						</div>
					</div>

					<!-- Match / Clicks / Time -->
					<div class="hidden shrink-0 gap-4 text-right sm:flex">
						<div>
							<div class="font-mono text-xs tabular-nums" style="color: #4ade80;">{entry.kl < 0.001 ? '<.001' : (Math.round((1/(1+100*entry.kl))*100)) + '%'}</div>
							<div class="text-[9px]" style="color: var(--text-tertiary);">match</div>
						</div>
						<div>
							<div class="font-mono text-xs tabular-nums" style="color: var(--accent-orange);">{entry.clicks}</div>
							<div class="text-[9px]" style="color: var(--text-tertiary);">clicks</div>
						</div>
						<div>
							<div class="font-mono text-xs tabular-nums" style="color: var(--accent-purple);">{formatTime(entry.duration)}</div>
							<div class="text-[9px]" style="color: var(--text-tertiary);">time</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	</div>
</div>
