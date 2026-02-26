<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { difficultyColor } from '$lib/game/difficulty';
	import { Swords } from 'lucide-svelte';

	let { data } = $props();

	type Tab = 'solo' | 'battle';
	let activeTab = $state<Tab>('solo');

	const soloEntries = $derived(data.bySolo);
	const battleEntries = $derived(data.byBattle);

	function countryFlag(code: string | null): string {
		if (!code || code.length !== 2) return '';
		return String.fromCodePoint(
			...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
		);
	}
</script>

<svelte:head>
	<title>Leaderboard — macmac</title>
</svelte:head>

<div class="min-h-dvh">
	<AppHeader activePage="leaderboard" />

	<div class="mx-auto max-w-2xl px-4 pb-12 pt-4 sm:px-6">
		<!-- Tabs -->
		<div class="mb-5 flex gap-1.5">
			<button
				onclick={() => (activeTab = 'solo')}
				class="flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12px] font-medium transition"
				style={activeTab === 'solo'
					? 'background: var(--surface); border: 1px solid var(--border-hover); color: var(--text-primary);'
					: 'border: 1px solid transparent; color: var(--text-tertiary);'}
			>
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"
					><path
						fill-rule="evenodd"
						d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z"
						clip-rule="evenodd"
					/></svg
				>
				Solo
			</button>
			<button
				onclick={() => (activeTab = 'battle')}
				class="flex items-center gap-1.5 rounded-2xl px-4 py-2 text-[12px] font-medium transition"
				style={activeTab === 'battle'
					? 'background: var(--surface); border: 1px solid var(--border-hover); color: var(--text-primary);'
					: 'border: 1px solid transparent; color: var(--text-tertiary);'}
			>
				<Swords class="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
				Battle
			</button>
		</div>

		{#if activeTab === 'solo'}
			<!-- Solo leaderboard -->
			{#if soloEntries.length === 0}
				<div class="rounded-2xl py-14 text-center" style="background: var(--surface);">
					<svg
						viewBox="0 0 24 24"
						fill="currentColor"
						class="mx-auto mb-3 h-7 w-7"
						style="color: var(--text-tertiary); opacity: 0.25;"
						><path
							d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z"
						/></svg
					>
					<div class="text-sm" style="color: var(--text-tertiary);">No scores yet</div>
					<a
						href="/"
						class="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[12px] font-semibold transition hover:brightness-110"
						style="background: color-mix(in srgb, var(--accent-cyan) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);"
					>
						Play a level
					</a>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full table-fixed">
						<colgroup>
							<col class="w-8" />
							<col />
							<col class="w-20" />
							<col class="hidden w-20 sm:table-column" />
							<col class="w-16" />
						</colgroup>
						<thead>
							<tr
								class="text-[10px] font-medium uppercase tracking-wider"
								style="color: var(--text-tertiary);"
							>
								<th class="pb-2 text-left">#</th>
								<th class="pb-2 text-left">Player</th>
								<th class="pb-2 text-right">Score</th>
								<th class="hidden pb-2 text-right sm:table-cell">Difficulty</th>
								<th class="pb-2 text-right">Games</th>
							</tr>
						</thead>
						<tbody>
							{#each soloEntries as entry, i}
								<tr
									class="border-t text-sm"
									style="border-color: var(--border); color: {i === 0
										? 'var(--accent-cyan)'
										: 'var(--text-primary)'}; opacity: {i === 0 ? 1 : i < 3 ? 0.75 : 0.5};"
								>
									<td class="py-3 font-mono text-xs font-bold tabular-nums">{i + 1}</td>
									<td class="truncate py-3 pr-2 font-medium">
										{#if entry.country}<span class="mr-1">{countryFlag(entry.country)}</span
										>{/if}{entry.playerName}
									</td>
									<td class="py-3 text-right font-mono font-bold tabular-nums"
										>{entry.bestWeightedScore.toLocaleString()}</td
									>
									<td
										class="hidden py-3 text-right font-mono text-xs tabular-nums sm:table-cell"
										style="color: {difficultyColor(entry.bestScoreDifficulty)};"
									>
										{entry.bestScoreDifficulty.toFixed(1)}
									</td>
									<td
										class="py-3 text-right font-mono text-xs tabular-nums"
										style="color: var(--text-tertiary);"
									>
										{entry.gamesPlayed}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else}
			<!-- Battle leaderboard -->
			{#if battleEntries.length === 0}
				<div class="rounded-2xl py-14 text-center" style="background: var(--surface);">
					<Swords class="mx-auto mb-3 h-7 w-7" strokeWidth={1.5} style="color: var(--text-tertiary); opacity: 0.25;" />
					<div class="text-sm" style="color: var(--text-tertiary);">No battles yet</div>
					<a
						href="/?battle"
						class="mt-3 inline-flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[12px] font-semibold transition hover:brightness-110"
						style="background: color-mix(in srgb, var(--accent-cyan) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-cyan) 25%, transparent); color: var(--accent-cyan);"
					>
						Start a battle
					</a>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full table-fixed">
						<colgroup>
							<col class="w-8" />
							<col />
							<col class="w-16" />
							<col class="w-10" />
							<col class="w-10" />
							<col class="hidden w-14 sm:table-column" />
						</colgroup>
						<thead>
							<tr
								class="text-[10px] font-medium uppercase tracking-wider"
								style="color: var(--text-tertiary);"
							>
								<th class="pb-2 text-left">#</th>
								<th class="pb-2 text-left">Player</th>
								<th class="pb-2 text-right">ELO</th>
								<th class="pb-2 text-right">W</th>
								<th class="pb-2 text-right">L</th>
								<th class="hidden pb-2 text-right sm:table-cell">Win%</th>
							</tr>
						</thead>
						<tbody>
							{#each battleEntries as entry, i}
								{@const losses = entry.battlesPlayed - entry.battleWins}
								{@const winPct = entry.battlesPlayed > 0 ? Math.round((entry.battleWins / entry.battlesPlayed) * 100) : 0}
								<tr
									class="border-t text-sm"
									style="border-color: var(--border); color: {i === 0
										? 'var(--accent-cyan)'
										: 'var(--text-primary)'}; opacity: {i === 0 ? 1 : i < 3 ? 0.75 : 0.5};"
								>
									<td class="py-3 font-mono text-xs font-bold tabular-nums">{i + 1}</td>
									<td class="truncate py-3 pr-2 font-medium">
										{#if entry.country}<span class="mr-1">{countryFlag(entry.country)}</span
										>{/if}{entry.playerName}
									</td>
									<td
										class="py-3 text-right font-mono font-bold tabular-nums"
										style="color: var(--accent-cyan);"
									>
										{entry.battleElo}
									</td>
									<td
										class="py-3 text-right font-mono text-xs tabular-nums"
										style="color: var(--win-green);"
									>
										{entry.battleWins}
									</td>
									<td
										class="py-3 text-right font-mono text-xs tabular-nums"
										style="color: var(--loss-red);"
									>
										{losses}
									</td>
									<td
										class="hidden py-3 text-right font-mono text-xs tabular-nums sm:table-cell"
										style="color: var(--text-tertiary);"
									>
										{winPct}%
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</div>
</div>
