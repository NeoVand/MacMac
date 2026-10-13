<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { computeSkillLevel, getSkillTier } from '$lib/game/rating';
	import { getBattleTier } from '$lib/game/elo';
	import { resolve } from '$app/paths';

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

<div class="leaderboard-page">
	<AppHeader activePage="leaderboard" />
	<main class="leaderboard-content">
		<header class="leaderboard-heading">
			<div>
				<h1>Leaderboard</h1>
				<p>Close matches. Consistent play. A place among the best.</p>
			</div>
			<a href={resolve('/')} class="play-link">Choose a curve</a>
		</header>
		<div class="leaderboard-modes" role="group" aria-label="Leaderboard mode">
			<button
				type="button"
				aria-pressed={activeTab === 'solo'}
				class={{ active: activeTab === 'solo' }}
				onclick={() => (activeTab = 'solo')}>Solo skill</button
			><button
				type="button"
				aria-pressed={activeTab === 'battle'}
				class={{ active: activeTab === 'battle' }}
				onclick={() => (activeTab = 'battle')}>Duel Elo</button
			>
		</div>
		<p class="rating-explanation">
			{activeTab === 'solo'
				? 'Skill reflects recent scores, adjusted for curve difficulty.'
				: 'Elo reflects your duel results and the strength of your opponents.'}
		</p>

		{#if activeTab === 'solo'}
			{#if soloEntries.length === 0}<div class="empty-board">
					<h2>No solo scores yet.</h2>
					<p>Play a round, then sign in to save your result.</p>
					<a href={resolve('/')}>Play solo</a>
				</div>
			{:else}<div class="table-wrap">
					<table aria-label="Solo skill leaderboard">
						<colgroup
							><col class="rank-column" /><col /><col class="rating-column" /><col
								class="best-column"
							/><col class="games-column" /></colgroup
						><thead
							><tr
								><th scope="col" class="rank-cell">Rank</th><th scope="col">Player</th><th
									scope="col"
									class="numeric">Skill</th
								><th scope="col" class="numeric best-cell">Best score</th><th
									scope="col"
									class="numeric">Games</th
								></tr
							></thead
						><tbody>
							{#each soloEntries as entry, i (entry)}
								{@const skillLevel = computeSkillLevel(entry.rating)}{@const tier =
									getSkillTier(skillLevel)}
								<tr class={{ leading: i === 0 }}
									><td class="rank-cell">{i + 1}</td><th scope="row" class="player-cell"
										><span class="player-identity"
											><span aria-hidden="true"
												><RankBadge mode="solo" value={skillLevel} size="sm" /></span
											><span class="player-name" title={entry.playerName}>{entry.playerName}</span
											>{#if entry.country}<span
													class="country"
													title={entry.country}
													aria-hidden="true">{countryFlag(entry.country)}</span
												>{/if}</span
										><span class="player-tier">{tier.name}</span></th
									><td class="numeric rating-value">{skillLevel.toLocaleString()}</td><td
										class="numeric best-cell">{entry.bestWeightedScore.toLocaleString()}</td
									><td class="numeric">{entry.gamesPlayed}</td></tr
								>
							{/each}
						</tbody>
					</table>
				</div>{/if}
		{:else if battleEntries.length === 0}<div class="empty-board">
				<h2>No duels yet.</h2>
				<p>Meet another player on the same curve and start the standings.</p>
				<a href={resolve('/?battle')}>Play a duel</a>
			</div>
		{:else}<div class="table-wrap">
				<table aria-label="Duel Elo leaderboard">
					<colgroup
						><col class="rank-column" /><col /><col class="rating-column" /><col
							class="record-column"
						/><col class="record-column" /><col class="win-column" /></colgroup
					><thead
						><tr
							><th scope="col" class="rank-cell">Rank</th><th scope="col">Player</th><th
								scope="col"
								class="numeric">Elo</th
							><th scope="col" class="numeric record-cell">Wins</th><th
								scope="col"
								class="numeric record-cell">Losses</th
							><th scope="col" class="numeric win-cell">Win rate</th></tr
						></thead
					><tbody>
						{#each battleEntries as entry, i (entry)}
							{@const losses = entry.battlesPlayed - entry.battleWins}{@const winPct =
								entry.battlesPlayed > 0
									? Math.round((entry.battleWins / entry.battlesPlayed) * 100)
									: 0}{@const tier = getBattleTier(entry.battleElo)}
							<tr class={{ leading: i === 0 }}
								><td class="rank-cell">{i + 1}</td><th scope="row" class="player-cell"
									><span class="player-identity"
										><span aria-hidden="true"
											><RankBadge mode="battle" value={entry.battleElo} size="sm" /></span
										><span class="player-name" title={entry.playerName}>{entry.playerName}</span
										>{#if entry.country}<span
												class="country"
												title={entry.country}
												aria-hidden="true">{countryFlag(entry.country)}</span
											>{/if}</span
									><span class="player-tier">{tier.name}</span></th
								><td class="numeric rating-value">{entry.battleElo}</td><td
									class="numeric record-cell">{entry.battleWins}</td
								><td class="numeric record-cell">{losses}</td><td class="numeric win-cell"
									>{winPct}%</td
								></tr
							>
						{/each}
					</tbody>
				</table>
			</div>{/if}
	</main>
</div>

<style>
	.leaderboard-page {
		min-height: 100dvh;
		background: var(--bg);
	}
	.leaderboard-content {
		width: min(980px, 100%);
		padding: 44px 32px 64px;
		margin: 0 auto;
	}
	.leaderboard-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 30px;
	}
	.leaderboard-heading h1 {
		margin: 0 0 10px;
		font-family: var(--font-display);
		font-size: 42px;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.065em;
	}
	.leaderboard-heading p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 14px;
		line-height: 1.6;
	}
	.play-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 42px;
		padding: 0 15px;
		border: 0;
		background: var(--surface);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 12px;
		white-space: nowrap;
	}
	.play-link:hover {
		background: var(--surface);
	}
	.leaderboard-modes {
		display: inline-flex;
		gap: 3px;
		padding: 3px;
		border: 0;
		border-radius: 8px;
		background: var(--surface);
	}
	.leaderboard-modes button {
		min-height: 42px;
		min-width: 120px;
		padding: 0 20px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}
	.leaderboard-modes button.active {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
	.leaderboard-modes button:hover {
		color: var(--text-primary);
	}
	.rating-explanation {
		margin: 14px 0 28px;
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.6;
	}
	.table-wrap {
		border-top: 1px solid var(--border-hover);
	}
	table {
		width: 100%;
		table-layout: fixed;
		border-collapse: collapse;
	}
	.rank-column {
		width: 58px;
	}
	.rating-column {
		width: 104px;
	}
	.best-column {
		width: 120px;
	}
	.games-column {
		width: 78px;
	}
	.record-column {
		width: 70px;
	}
	.win-column {
		width: 88px;
	}
	thead th {
		height: 46px;
		padding: 0 12px;
		text-align: left;
		color: var(--text-secondary);
		font-size: 11px;
		font-weight: 500;
	}
	tbody tr {
		border-top: 1px solid var(--border);
	}
	tbody tr.leading {
		background: color-mix(in srgb, var(--accent-cyan) 4%, transparent);
	}
	tbody tr:hover {
		background: var(--surface);
	}
	tbody td,
	tbody th {
		height: 67px;
		padding: 10px 12px;
		color: var(--text-primary);
		font-size: 13px;
		font-weight: 400;
	}
	tbody .rank-cell {
		color: var(--text-secondary);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	tbody .leading .rank-cell {
		color: var(--accent-cyan);
		font-weight: 600;
	}
	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	tbody .rating-value {
		font-family: var(--font-display);
		font-size: 16px;
		font-weight: 500;
		letter-spacing: -0.03em;
	}
	.player-cell {
		text-align: left;
	}
	.player-identity {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.player-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.country {
		flex-shrink: 0;
		font-size: 12px;
	}
	.player-tier {
		display: block;
		padding-left: 24px;
		margin-top: 3px;
		color: var(--text-secondary);
		font-size: 10px;
	}
	.empty-board {
		padding: 52px 24px;
		text-align: center;
	}
	.empty-board h2 {
		margin: 0 0 10px;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 500;
		letter-spacing: -0.04em;
	}
	.empty-board p {
		margin: 0 auto 22px;
		max-width: 45ch;
		color: var(--text-secondary);
		font-size: 13px;
		line-height: 1.6;
	}
	.empty-board a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0 20px;
		border-radius: 6px;
		background: var(--accent-cyan);
		color: var(--on-accent);
		font-size: 13px;
		font-weight: 600;
	}
	@media (max-width: 640px) {
		.leaderboard-content {
			padding: 28px 16px 40px;
		}
		.leaderboard-heading {
			align-items: start;
			margin-bottom: 24px;
		}
		.leaderboard-heading h1 {
			font-size: 32px;
		}
		.leaderboard-heading p {
			max-width: 28ch;
			font-size: 12px;
		}
		.play-link {
			min-height: 40px;
			padding: 0 10px;
			font-size: 10px;
		}
		.rank-column {
			width: 36px;
		}
		.rating-column {
			width: 70px;
		}
		.games-column {
			width: 48px;
		}
		.record-column {
			width: 44px;
		}
		.best-column,
		.best-cell,
		.win-column,
		.win-cell {
			display: none;
		}
		thead th {
			padding-inline: 5px;
			font-size: 10px;
		}
		tbody td,
		tbody th {
			padding-inline: 5px;
			font-size: 11px;
		}
		tbody .rating-value {
			font-size: 14px;
		}
		.player-identity {
			gap: 5px;
		}
		.player-tier {
			padding-left: 21px;
		}
	}
</style>
