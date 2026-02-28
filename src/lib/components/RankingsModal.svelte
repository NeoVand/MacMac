<script lang="ts">
	import RankBadge from './RankBadge.svelte';
	import { SKILL_TIERS, getSkillTier, getTierProgress, computeSkillLevel } from '$lib/game/rating';
	import { BATTLE_TIERS, getBattleTier, getBattleTierProgress } from '$lib/game/elo';

	let {
		open = false,
		onclose,
		playerRating = null,
		battleElo = null,
		gamesPlayed = 0,
		battlesPlayed = 0
	}: {
		open: boolean;
		onclose: () => void;
		playerRating?: number | null;
		battleElo?: number | null;
		gamesPlayed?: number;
		battlesPlayed?: number;
	} = $props();

	let tab = $state<'solo' | 'battle'>('solo');
	let selectedTier = $state<number | null>(null);

	const skillLevel = $derived(playerRating !== null ? computeSkillLevel(playerRating) : 0);
	const soloTier = $derived(getSkillTier(skillLevel));
	const soloProgress = $derived(getTierProgress(skillLevel));
	const soloTierIdx = $derived(SKILL_TIERS.indexOf(soloTier));

	const elo = $derived(battleElo ?? 1200);
	const bTier = $derived(getBattleTier(elo));
	const bProgress = $derived(getBattleTierProgress(elo));
	const bTierIdx = $derived(BATTLE_TIERS.indexOf(bTier));

	/** Whether the user has any data for the active tab */
	const hasSoloData = $derived(playerRating !== null && gamesPlayed > 0);
	const hasBattleData = $derived(battleElo !== null && battlesPlayed > 0);

	/** Progress track fill for solo */
	const soloCurrentIdx = $derived(hasSoloData ? soloTierIdx : -1);
	const soloFillPct = $derived(
		soloCurrentIdx >= 0
			? ((soloCurrentIdx + soloProgress) / (SKILL_TIERS.length - 1)) * 100
			: 0
	);
	const soloFillColor = $derived(soloCurrentIdx >= 0 ? soloTier.color : 'transparent');

	/** Progress track fill for battle */
	const battleCurrentIdx = $derived(hasBattleData ? bTierIdx : -1);
	const battleFillPct = $derived(
		battleCurrentIdx >= 0
			? ((battleCurrentIdx + bProgress) / (BATTLE_TIERS.length - 1)) * 100
			: 0
	);
	const battleFillColor = $derived(battleCurrentIdx >= 0 ? bTier.color : 'transparent');

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
	}

	function switchTab(t: 'solo' | 'battle') {
		tab = t;
		selectedTier = null;
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4"
		style="background: var(--overlay); backdrop-filter: blur(8px);"
		onclick={handleBackdrop}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	>
		<div class="relative w-full max-w-sm overflow-hidden rounded-2xl shadow-2xl" style="background: var(--bg); border: 1px solid var(--border); max-height: 85dvh;">
			<!-- Close button -->
			<button onclick={onclose} class="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-tertiary);" aria-label="Close">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-3.5 w-3.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>

			<div class="overflow-y-auto" style="max-height: 85dvh;">
				<!-- Header -->
				<div class="px-5 pt-5 pb-3 text-center">
					<h2 class="text-lg font-black" style="color: var(--text-primary);">Rankings</h2>
					<p class="mt-0.5 text-[11px]" style="color: var(--text-tertiary);">
						Earn ranks by playing games and climbing the tiers
					</p>
				</div>

				<!-- Tab switcher -->
				<div class="mx-5 mb-4 flex rounded-xl p-1" style="background: var(--surface);">
					<button
						onclick={() => switchTab('solo')}
						class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
						style="background: {tab === 'solo' ? 'var(--bg)' : 'transparent'}; color: {tab === 'solo' ? 'var(--accent-cyan)' : 'var(--text-tertiary)'}; {tab === 'solo' ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : ''}"
					>
						Solo Skill
					</button>
					<button
						onclick={() => switchTab('battle')}
						class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
						style="background: {tab === 'battle' ? 'var(--bg)' : 'transparent'}; color: {tab === 'battle' ? 'var(--accent-red)' : 'var(--text-tertiary)'}; {tab === 'battle' ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : ''}"
					>
						Battle ELO
					</button>
				</div>

				{#if tab === 'solo'}
					{#if hasSoloData}
						<!-- Solo stats card -->
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="mb-1 flex items-center justify-center gap-2">
								<RankBadge mode="solo" value={skillLevel} size="lg" />
								<div class="text-left">
									<div class="text-lg font-bold tabular-nums leading-none" style="color: {soloTier.color};">{skillLevel.toLocaleString()}</div>
									<div class="text-[10px] font-semibold" style="color: {soloTier.color};">{soloTier.name}</div>
								</div>
							</div>
							{#if soloTierIdx < SKILL_TIERS.length - 1}
								{@const nextTier = SKILL_TIERS[soloTierIdx + 1]}
								<div class="mt-2">
									<div class="mb-1 flex justify-between text-[9px] font-medium" style="color: var(--text-tertiary);">
										<span>{soloTier.name}</span>
										<span>{nextTier.name}</span>
									</div>
									<div class="h-1.5 overflow-hidden rounded-full" style="background: var(--border);">
										<div class="h-full rounded-full transition-all" style="width: {soloProgress * 100}%; background: {soloTier.color};"></div>
									</div>
								</div>
							{/if}
							<div class="mt-2 text-[10px] tabular-nums" style="color: var(--text-tertiary);">
								{gamesPlayed} game{gamesPlayed !== 1 ? 's' : ''} played
							</div>
						</div>
					{:else}
						<!-- Sign in prompt -->
						<div class="mx-5 mb-4 rounded-xl p-4 text-center" style="background: var(--surface);">
							<div class="text-xs font-medium" style="color: var(--text-secondary);">Sign in and play to earn your rank</div>
						</div>
					{/if}

					<!-- Solo tier strip -->
					<div class="px-5 pb-5">
						<!-- Badges row -->
						<div class="flex items-end justify-between">
							{#each SKILL_TIERS as tier, i}
								{@const isCurrent = soloCurrentIdx === i}
								{@const isPast = soloCurrentIdx > i}
								{@const noData = soloCurrentIdx < 0}
								{@const nextThreshold = i < SKILL_TIERS.length - 1 ? SKILL_TIERS[i + 1].threshold : null}
								<button
									class="flex flex-col items-center border-none bg-transparent p-0 transition-all"
									style="opacity: {noData ? 0.7 : isCurrent ? 1 : isPast ? 0.7 : 0.35}; {isCurrent ? `filter: drop-shadow(0 0 6px ${tier.color});` : ''}"
									onclick={() => selectedTier = selectedTier === i ? null : i}
								>
									<div class="transition-transform" style="{isCurrent ? 'transform: scale(1.3);' : ''}">
										<RankBadge mode="solo" value={tier.threshold} size={isCurrent ? 'lg' : 'md'} />
									</div>
									<span
										class="mt-1 text-[9px] font-bold leading-none"
										style="color: {isCurrent ? tier.color : 'var(--text-tertiary)'};"
									>{tier.name}</span>
									{#if selectedTier === i}
										<span class="mt-0.5 text-[8px] tabular-nums leading-none" style="color: var(--text-tertiary);">
											{tier.threshold.toLocaleString()}{nextThreshold !== null ? `–${(nextThreshold - 1).toLocaleString()}` : '+'}
										</span>
									{/if}
								</button>
							{/each}
						</div>
						<!-- Progress track -->
						<div class="relative mx-auto mt-3 h-1 overflow-hidden rounded-full" style="background: var(--border); width: calc(100% - 16px);">
							<div class="absolute inset-y-0 left-0 rounded-full transition-all" style="width: {soloFillPct}%; background: {soloFillColor};"></div>
						</div>
					</div>

				{:else}
					{#if hasBattleData}
						<!-- Battle stats card -->
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="mb-1 flex items-center justify-center gap-2">
								<RankBadge mode="battle" value={elo} size="lg" />
								<div class="text-left">
									<div class="text-lg font-bold tabular-nums leading-none" style="color: {bTier.color};">{elo}</div>
									<div class="text-[10px] font-semibold" style="color: {bTier.color};">{bTier.name}</div>
								</div>
							</div>
							{#if bTierIdx < BATTLE_TIERS.length - 1}
								{@const nextTier = BATTLE_TIERS[bTierIdx + 1]}
								<div class="mt-2">
									<div class="mb-1 flex justify-between text-[9px] font-medium" style="color: var(--text-tertiary);">
										<span>{bTier.name}</span>
										<span>{nextTier.name}</span>
									</div>
									<div class="h-1.5 overflow-hidden rounded-full" style="background: var(--border);">
										<div class="h-full rounded-full transition-all" style="width: {bProgress * 100}%; background: {bTier.color};"></div>
									</div>
								</div>
							{/if}
							<div class="mt-2 text-[10px] tabular-nums" style="color: var(--text-tertiary);">
								{battlesPlayed} battle{battlesPlayed !== 1 ? 's' : ''} played
							</div>
						</div>
					{:else}
						<!-- Sign in prompt -->
						<div class="mx-5 mb-4 rounded-xl p-4 text-center" style="background: var(--surface);">
							<div class="text-xs font-medium" style="color: var(--text-secondary);">Sign in and play to earn your rank</div>
						</div>
					{/if}

					<!-- Battle tier strip -->
					<div class="px-5 pb-5">
						<!-- Badges row -->
						<div class="flex items-end justify-between">
							{#each BATTLE_TIERS as tier, i}
								{@const isCurrent = battleCurrentIdx === i}
								{@const isPast = battleCurrentIdx > i}
								{@const noData = battleCurrentIdx < 0}
								{@const nextThreshold = i < BATTLE_TIERS.length - 1 ? BATTLE_TIERS[i + 1].threshold : null}
								<button
									class="flex flex-col items-center border-none bg-transparent p-0 transition-all"
									style="opacity: {noData ? 0.7 : isCurrent ? 1 : isPast ? 0.7 : 0.35}; {isCurrent ? `filter: drop-shadow(0 0 6px ${tier.color});` : ''}"
									onclick={() => selectedTier = selectedTier === i ? null : i}
								>
									<div class="transition-transform" style="{isCurrent ? 'transform: scale(1.3);' : ''}">
										<RankBadge mode="battle" value={tier.threshold} size={isCurrent ? 'lg' : 'md'} />
									</div>
									<span
										class="mt-1 text-[9px] font-bold leading-none"
										style="color: {isCurrent ? tier.color : 'var(--text-tertiary)'};"
									>{tier.name}</span>
									{#if selectedTier === i}
										<span class="mt-0.5 text-[8px] tabular-nums leading-none" style="color: var(--text-tertiary);">
											ELO {tier.threshold.toLocaleString()}{nextThreshold !== null ? `–${(nextThreshold - 1).toLocaleString()}` : '+'}
										</span>
									{/if}
								</button>
							{/each}
						</div>
						<!-- Progress track -->
						<div class="relative mx-auto mt-3 h-1 overflow-hidden rounded-full" style="background: var(--border); width: calc(100% - 16px);">
							<div class="absolute inset-y-0 left-0 rounded-full transition-all" style="width: {battleFillPct}%; background: {battleFillColor};"></div>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
