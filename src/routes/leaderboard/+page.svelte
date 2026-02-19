<script lang="ts">
	import { levels } from '$lib/game/levels';
	import { getDifficultyColor } from '$lib/game/scoring';

	let { data } = $props();

	let selectedLevel = $state(1);
	const currentLevel = $derived(levels.find((l) => l.id === selectedLevel)!);
	const entries = $derived(data.leaderboardData[selectedLevel] || []);
</script>

<svelte:head>
	<title>Leaderboard — macmac</title>
</svelte:head>

<div class="mx-auto min-h-dvh max-w-2xl px-6 py-8 sm:px-10">
	<!-- Header -->
	<div class="mb-8 flex items-center justify-between">
		<div>
			<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
				<span class="text-sm text-white/50">mac</span><span class="text-sm text-game-cyan/50">mac</span>
			</a>
			<h1 class="mt-1.5 text-xl font-bold text-white">Leaderboard</h1>
		</div>
		<a
			href="/play/1"
			class="flex h-10 items-center gap-2 rounded-lg border border-game-cyan/30 bg-game-cyan/10 px-5 text-[13px] font-semibold text-game-cyan transition hover:border-game-cyan/50 hover:bg-game-cyan/15"
		>
			<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" /></svg>
			Play
		</a>
	</div>

	<!-- Level Tabs -->
	<div class="mb-6 flex gap-1 overflow-x-auto pb-2">
		{#each levels as level}
			<button
				onclick={() => (selectedLevel = level.id)}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition {selectedLevel === level.id
					? 'bg-white/10 text-white'
					: 'text-white/40 hover:bg-white/5 hover:text-white/60'}"
			>
				<span
					class="h-1.5 w-1.5 rounded-full"
					style="background-color: {getDifficultyColor(level.difficulty)}"
				></span>
				<span class="hidden sm:inline">{level.name}</span>
				<span class="sm:hidden">L{level.id}</span>
			</button>
		{/each}
	</div>

	<!-- Level Info -->
	<div class="mb-4 flex items-center gap-3">
		<h2 class="text-lg font-semibold text-white/80">{currentLevel.name}</h2>
		<span class="text-xs text-white/30 capitalize">{currentLevel.difficulty}</span>
		<span class="text-xs text-white/20">Par: {currentLevel.par} clicks</span>
	</div>

	<!-- Table -->
	{#if entries.length === 0}
		<div class="rounded-xl bg-white/[0.02] py-16 text-center">
			<div class="mb-2 text-2xl text-white/10">---</div>
			<div class="text-sm text-white/30">No scores yet for this level.</div>
			<a
				href="/play/{currentLevel.id}"
				class="mt-3 inline-block text-sm text-game-cyan/60 transition hover:text-game-cyan"
			>
				Be the first
			</a>
		</div>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead>
					<tr class="text-left text-[10px] tracking-wider text-white/25 uppercase">
						<th class="pb-3 pr-4">#</th>
						<th class="pb-3 pr-4">Player</th>
						<th class="pb-3 pr-4 text-right">Score</th>
						<th class="pb-3 pr-4 text-right">KL</th>
						<th class="pb-3 text-right">Clicks</th>
					</tr>
				</thead>
				<tbody>
					{#each entries as entry, i}
						<tr class="transition {i === 0 ? 'text-game-cyan' : i < 3 ? 'text-white/60' : 'text-white/35'}">
							<td class="py-2.5 pr-4 font-mono text-xs tabular-nums">
								{#if i === 0}
									<span class="text-sm">1</span>
								{:else}
									{i + 1}
								{/if}
							</td>
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
