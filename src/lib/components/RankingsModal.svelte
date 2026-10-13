<script lang="ts">
	import RankBadge from './RankBadge.svelte';
	import { SKILL_TIERS, getSkillTier, getTierProgress, computeSkillLevel } from '$lib/game/rating';
	import { BATTLE_TIERS, getBattleTier, getBattleTierProgress } from '$lib/game/elo';
	import { signInWithProvider } from '$lib/auth-client';
	import { Github } from 'lucide-svelte';

	let {
		open = false,
		onclose,
		isAuthenticated = false,
		playerRating = null,
		battleElo = null,
		gamesPlayed = 0,
		battlesPlayed = 0
	}: {
		open: boolean;
		onclose: () => void;
		isAuthenticated?: boolean;
		playerRating?: number | null;
		battleElo?: number | null;
		gamesPlayed?: number;
		battlesPlayed?: number;
	} = $props();

	let tab = $state<'solo' | 'battle'>('solo');
	let selectedTier = $state<number | null>(null);
	let isSigningIn = $state(false);
	let signInError = $state('');

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

	const uid = $props.id();
	const tiers = $derived(tab === 'solo' ? SKILL_TIERS : BATTLE_TIERS);
	const hasData = $derived(tab === 'solo' ? hasSoloData : hasBattleData);
	const currentTier = $derived(tab === 'solo' ? soloTier : bTier);
	const currentValue = $derived(tab === 'solo' ? skillLevel : elo);
	const currentProgress = $derived(tab === 'solo' ? soloProgress : bProgress);
	const currentIdx = $derived(hasData ? (tab === 'solo' ? soloTierIdx : bTierIdx) : -1);
	const nextTier = $derived(tiers[currentIdx + 1]);
	const journeyProgress = $derived(
		currentIdx >= 0 ? Math.min(100, ((currentIdx + currentProgress) / (tiers.length - 1)) * 100) : 0
	);
	const selected = $derived(selectedTier !== null ? tiers[selectedTier] : null);
	const selectedNext = $derived(selectedTier !== null ? tiers[selectedTier + 1] : null);

	function attachDialog(node: HTMLDialogElement) {
		const previousFocus = document.activeElement;
		node.showModal();
		return () => {
			node.close();
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		};
	}

	function handleBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onclose();
	}

	function switchTab(t: 'solo' | 'battle') {
		tab = t;
		selectedTier = null;
	}

	async function signInWith(provider: 'github' | 'google') {
		if (isSigningIn) return;
		isSigningIn = true;
		signInError = '';
		try {
			await signInWithProvider(provider);
		} catch (error) {
			signInError = error instanceof Error ? error.message : 'Sign-in failed. Please try again.';
		} finally {
			isSigningIn = false;
		}
	}
</script>

{#if open}
	<dialog
		{@attach attachDialog}
		class="rankings-dialog"
		aria-labelledby="{uid}-title"
		aria-describedby="{uid}-description"
		onclick={handleBackdrop}
		oncancel={(event) => {
			event.preventDefault();
			onclose();
		}}
	>
		<div
			class="rankings-panel"
			style:--mode-accent={tab === 'solo' ? 'var(--accent-cyan)' : 'var(--accent-purple)'}
		>
			<header class="rankings-header">
				<div>
					<h2 id="{uid}-title">Your rankings</h2>
					<p id="{uid}-description">Your solo skill, duel rating, and rank tiers.</p>
				</div>
				<button type="button" class="close-rankings" onclick={onclose} aria-label="Close rankings"
					><svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" /></svg
					></button
				>
			</header>
			<div class="rankings-modes" role="group" aria-label="Rating mode">
				<button type="button" aria-pressed={tab === 'solo'} onclick={() => switchTab('solo')}
					>Solo skill</button
				><button type="button" aria-pressed={tab === 'battle'} onclick={() => switchTab('battle')}
					>Duel Elo</button
				>
			</div>
			{#if signInError}<p role="alert" class="sign-in-error">{signInError}</p>{/if}
			{#if hasData}
				<div class="rating-summary">
					<div class="rating-heading">
						<span class="rating-number">{currentValue.toLocaleString()}</span><span
							class="rating-tier"
							><RankBadge mode={tab} value={currentValue} size="md" />{currentTier.name}</span
						>
					</div>
					<span class="games-played"
						>{tab === 'solo' ? gamesPlayed : battlesPlayed}
						{tab === 'solo'
							? gamesPlayed === 1
								? 'round'
								: 'rounds'
							: battlesPlayed === 1
								? 'duel'
								: 'duels'} played</span
					>
					{#if currentIdx < tiers.length - 1 && nextTier}<div class="next-tier">
							<span>{currentTier.name}</span><span
								>{nextTier.name} at {nextTier.threshold.toLocaleString()}</span
							>
						</div>
						<div
							class="progress-track"
							role="progressbar"
							aria-label="Progress towards {nextTier.name}"
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={Math.round(currentProgress * 100)}
						>
							<span style:width="{currentProgress * 100}%"></span>
						</div>{/if}
				</div>
			{:else}<div class="rating-empty">
					<h3>
						{isAuthenticated
							? tab === 'solo'
								? 'Your first rating is ahead.'
								: 'Your first duel is ahead.'
							: 'Save your results.'}
					</h3>
					<p>
						{isAuthenticated
							? tab === 'solo'
								? 'Play and save a solo round to build your skill rating.'
								: 'Complete a duel to establish your Elo rating.'
							: 'Sign in to save your results and build a rating.'}
					</p>
					{#if !isAuthenticated}<div class="sign-in-options">
							<button type="button" onclick={() => signInWith('github')} disabled={isSigningIn}
								><Github size={16} />Continue with GitHub</button
							><button type="button" onclick={() => signInWith('google')} disabled={isSigningIn}
								><svg viewBox="0 0 24 24" aria-hidden="true"
									><path
										fill="#4285F4"
										d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
									/><path
										fill="#34A853"
										d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
									/><path
										fill="#FBBC05"
										d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
									/><path
										fill="#EA4335"
										d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
									/></svg
								>Continue with Google</button
							>
						</div>{/if}
				</div>{/if}
			<section class="tier-journey" aria-label="Rating tiers">
				<h3>Your path through the tiers</h3>
				<div class="tier-grid">
					{#each tiers as tier, i (tier.name)}<button
							type="button"
							class={{ current: currentIdx === i, selected: selectedTier === i }}
							aria-pressed={selectedTier === i}
							aria-label="{tier.name}, starts at {tier.threshold.toLocaleString()}{currentIdx === i
								? ', your current tier'
								: ''}"
							onclick={() => (selectedTier = selectedTier === i ? null : i)}
							><span aria-hidden="true"
								><RankBadge mode={tab} value={tier.threshold} size="md" /></span
							><span>{tier.name}</span>{#if currentIdx === i}<span class="current-marker"
								></span>{/if}</button
						>{/each}
				</div>
				<div class="journey-track" aria-hidden="true">
					<span style:width="{journeyProgress}%"></span>
				</div>
				{#if selected}<p class="tier-details">
						<strong>{selected.name}</strong>
						{tab === 'solo' ? 'Skill' : 'Elo'}
						{selected.threshold.toLocaleString()}{selectedNext
							? `–${(selectedNext.threshold - 1).toLocaleString()}`
							: '+'}
					</p>{:else}<p class="tier-details">Select a tier to see its rating range.</p>{/if}
			</section>
			<p class="rating-explanation">
				{tab === 'solo'
					? 'Solo skill reflects recent scores, adjusted for curve difficulty.'
					: 'Duel Elo changes with each result and your opponent’s rating.'}
			</p>
		</div>
	</dialog>
{/if}

<style>
	.rankings-dialog {
		width: min(520px, calc(100vw - 32px));
		max-height: min(86dvh, 760px);
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: var(--surface);
		color: var(--text-primary);
		box-shadow: var(--stage-shadow);
	}
	.rankings-dialog::backdrop {
		background: var(--overlay);
		backdrop-filter: blur(5px);
	}
	.rankings-panel {
		padding: 28px;
	}
	.rankings-header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 23px;
	}
	.rankings-header h2 {
		margin: 0 0 7px;
		font-family: var(--font-display);
		font-size: 27px;
		font-weight: 500;
		letter-spacing: -0.055em;
		line-height: 1.2;
	}
	.rankings-header p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.5;
	}
	.close-rankings {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 40px;
		height: 40px;
		margin-top: -6px;
		margin-right: -8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.close-rankings:hover {
		color: var(--text-primary);
		background: var(--surface-raised);
	}
	.close-rankings svg {
		width: 18px;
		height: 18px;
	}
	.rankings-modes {
		display: flex;
		gap: 3px;
		padding: 3px;
		border: 0;
		border-radius: 7px;
		background: var(--bg);
	}
	.rankings-modes button {
		flex: 1;
		min-height: 42px;
		border: 0;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}
	.rankings-modes button[aria-pressed='true'] {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
	.sign-in-error {
		margin: 14px 0 0;
		color: var(--accent-orange);
		font-size: 12px;
		line-height: 1.6;
	}
	.rating-summary {
		padding: 25px 0 23px;
	}
	.rating-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.rating-number {
		color: var(--mode-accent);
		font-family: var(--font-display);
		font-size: 46px;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.06em;
		font-variant-numeric: tabular-nums;
	}
	.rating-tier {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 500;
		letter-spacing: -0.025em;
	}
	.games-played {
		display: block;
		margin-top: 6px;
		color: var(--text-secondary);
		font-size: 11px;
	}
	.next-tier {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin: 23px 0 9px;
		color: var(--text-secondary);
		font-size: 10px;
	}
	.progress-track,
	.journey-track {
		height: 4px;
		overflow: hidden;
		border-radius: 2px;
		background: var(--border);
	}
	.progress-track span,
	.journey-track span {
		display: block;
		height: 100%;
		background: var(--mode-accent);
	}
	.rating-empty {
		padding: 26px 0 24px;
	}
	.rating-empty h3 {
		margin: 0 0 8px;
		font-family: var(--font-display);
		font-size: 20px;
		font-weight: 500;
		letter-spacing: -0.04em;
	}
	.rating-empty p {
		margin: 0;
		color: var(--text-secondary);
		font-size: 12px;
		line-height: 1.6;
	}
	.sign-in-options {
		display: flex;
		gap: 9px;
		margin-top: 20px;
	}
	.sign-in-options button {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 8px 10px;
		border: 0;
		border-radius: 6px;
		background: var(--bg);
		color: var(--text-primary);
		font-size: 11px;
		cursor: pointer;
	}
	.sign-in-options button:hover {
		background: var(--surface-raised);
	}
	.sign-in-options button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	.sign-in-options svg {
		width: 15px;
		height: 15px;
		flex-shrink: 0;
	}
	.tier-journey {
		margin-top: 24px;
	}
	.tier-journey h3 {
		margin: 0 0 15px;
		font-size: 12px;
		font-weight: 500;
	}
	.tier-grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 4px;
	}
	.tier-grid button {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 70px;
		padding: 8px 3px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 11px;
		cursor: pointer;
	}
	.tier-grid button.current {
		color: var(--text-primary);
	}
	.tier-grid button:hover,
	.tier-grid button.selected {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
	.current-marker {
		position: absolute;
		bottom: 2px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--mode-accent);
	}
	.journey-track {
		margin: 12px 8px 0;
		height: 3px;
	}
	.tier-details {
		min-height: 20px;
		margin: 12px 0 0;
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.6;
	}
	.tier-details strong {
		margin-right: 7px;
		color: var(--text-primary);
		font-weight: 500;
	}
	.rating-explanation {
		margin: 19px 0 0;
		color: var(--text-secondary);
		font-size: 11px;
		line-height: 1.6;
	}
	@media (max-width: 480px) {
		.rankings-panel {
			padding: 22px 18px;
		}
		.rankings-header h2 {
			font-size: 25px;
		}
		.sign-in-options {
			flex-direction: column;
		}
		.tier-grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 6px;
		}
		.tier-grid button {
			font-size: 11px;
		}
		.rating-number {
			font-size: 42px;
		}
	}
</style>
