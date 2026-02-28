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

	const skillLevel = $derived(playerRating !== null ? computeSkillLevel(playerRating) : 0);
	const soloTier = $derived(getSkillTier(skillLevel));
	const soloProgress = $derived(getTierProgress(skillLevel));
	const soloTierIdx = $derived(SKILL_TIERS.indexOf(soloTier));

	const elo = $derived(battleElo ?? 1200);
	const bTier = $derived(getBattleTier(elo));
	const bProgress = $derived(getBattleTierProgress(elo));
	const bTierIdx = $derived(BATTLE_TIERS.indexOf(bTier));

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onclose();
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
						onclick={() => tab = 'solo'}
						class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
						style="background: {tab === 'solo' ? 'var(--bg)' : 'transparent'}; color: {tab === 'solo' ? 'var(--accent-cyan)' : 'var(--text-tertiary)'}; {tab === 'solo' ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : ''}"
					>
						Solo Skill
					</button>
					<button
						onclick={() => tab = 'battle'}
						class="flex-1 rounded-lg py-1.5 text-xs font-semibold transition"
						style="background: {tab === 'battle' ? 'var(--bg)' : 'transparent'}; color: {tab === 'battle' ? 'var(--accent-red)' : 'var(--text-tertiary)'}; {tab === 'battle' ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.1);' : ''}"
					>
						Battle ELO
					</button>
				</div>

				{#if tab === 'solo'}
					<!-- Solo: current stats -->
					{#if playerRating !== null && gamesPlayed > 0}
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="mb-1 flex items-center justify-center gap-2">
								<RankBadge mode="solo" value={skillLevel} size="lg" />
								<div class="text-left">
									<div class="text-lg font-bold tabular-nums leading-none" style="color: {soloTier.color};">{skillLevel.toLocaleString()}</div>
									<div class="text-[10px] font-semibold" style="color: {soloTier.color};">{soloTier.name}</div>
								</div>
							</div>
							<!-- Progress to next tier -->
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
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="text-xs" style="color: var(--text-tertiary);">Play solo games to earn a skill rating</div>
						</div>
					{/if}

					<!-- All solo tiers -->
					<div class="px-5 pb-5">
						<div class="mb-2 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--text-tertiary);">All Tiers</div>
						<div class="flex flex-col gap-1.5">
							{#each SKILL_TIERS as tier, i}
								{@const isCurrent = playerRating !== null && gamesPlayed > 0 && soloTierIdx === i}
								{@const nextThreshold = i < SKILL_TIERS.length - 1 ? SKILL_TIERS[i + 1].threshold : null}
								<div
									class="flex items-center gap-3 rounded-xl px-3 py-2 transition"
									style="background: {isCurrent ? `color-mix(in srgb, ${tier.color} 8%, var(--surface))` : 'transparent'}; border: 1px solid {isCurrent ? `color-mix(in srgb, ${tier.color} 20%, transparent)` : 'transparent'};"
								>
									<RankBadge mode="solo" value={tier.threshold} size="md" />
									<div class="flex-1">
										<div class="text-xs font-bold" style="color: {tier.color};">{tier.name}</div>
										<div class="text-[10px] tabular-nums" style="color: var(--text-tertiary);">
											{tier.threshold.toLocaleString()}{nextThreshold !== null ? ` – ${(nextThreshold - 1).toLocaleString()}` : '+'}
										</div>
									</div>
									{#if isCurrent}
										<div class="text-[9px] font-bold uppercase tracking-wider" style="color: {tier.color};">You</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>

				{:else}
					<!-- Battle: current stats -->
					{#if battleElo !== null && battlesPlayed > 0}
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="mb-1 flex items-center justify-center gap-2">
								<RankBadge mode="battle" value={elo} size="lg" />
								<div class="text-left">
									<div class="text-lg font-bold tabular-nums leading-none" style="color: {bTier.color};">{elo}</div>
									<div class="text-[10px] font-semibold" style="color: {bTier.color};">{bTier.name}</div>
								</div>
							</div>
							<!-- Progress to next tier -->
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
						<div class="mx-5 mb-4 rounded-xl p-3 text-center" style="background: var(--surface);">
							<div class="text-xs" style="color: var(--text-tertiary);">Play battles to earn an ELO rating</div>
						</div>
					{/if}

					<!-- All battle tiers -->
					<div class="px-5 pb-5">
						<div class="mb-2 text-[10px] font-semibold uppercase tracking-wider" style="color: var(--text-tertiary);">All Tiers</div>
						<div class="flex flex-col gap-1.5">
							{#each BATTLE_TIERS as tier, i}
								{@const isCurrent = battleElo !== null && battlesPlayed > 0 && bTierIdx === i}
								{@const nextThreshold = i < BATTLE_TIERS.length - 1 ? BATTLE_TIERS[i + 1].threshold : null}
								<div
									class="flex items-center gap-3 rounded-xl px-3 py-2 transition"
									style="background: {isCurrent ? `color-mix(in srgb, ${tier.color} 8%, var(--surface))` : 'transparent'}; border: 1px solid {isCurrent ? `color-mix(in srgb, ${tier.color} 20%, transparent)` : 'transparent'};"
								>
									<RankBadge mode="battle" value={tier.threshold} size="md" />
									<div class="flex-1">
										<div class="text-xs font-bold" style="color: {tier.color};">{tier.name}</div>
										<div class="text-[10px] tabular-nums" style="color: var(--text-tertiary);">
											ELO {tier.threshold.toLocaleString()}{nextThreshold !== null ? ` – ${(nextThreshold - 1).toLocaleString()}` : '+'}
										</div>
									</div>
									{#if isCurrent}
										<div class="text-[9px] font-bold uppercase tracking-wider" style="color: {tier.color};">You</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
