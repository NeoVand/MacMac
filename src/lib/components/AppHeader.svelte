<script lang="ts">
	import { ChevronLeft, ChevronRight, Info, MoreHorizontal, Swords, Trophy } from 'lucide-svelte';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import UserAvatar from './UserAvatar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import SoundButton from './SoundButton.svelte';
	import { battleQueue, cancelQueue } from '$lib/stores/battle-queue';

	interface Props {
		activePage?: 'leaderboard' | 'about' | 'none';
		showNav?: boolean;
		prevHref?: string | null;
		nextHref?: string | null;
	}

	let { activePage = 'none', showNav = false, prevHref = null, nextHref = null }: Props = $props();
	const searching = $derived(
		$battleQueue.status === 'searching' || $battleQueue.status === 'connecting'
	);
</script>

<header class="game-chrome" data-searching={searching}>
	<a href={resolve('/')} class="wordmark" aria-label="MacMac home">
		<span style="color: var(--text-primary); opacity: 0.85;">Mac</span><span
			class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-transparent">Mac</span
		>
	</a>

	<nav class="chrome-actions" aria-label="Game navigation">
		{#if showNav && prevHref}
			<a
				href={resolve(prevHref as Pathname)}
				class="chrome-control level-navigation"
				aria-label="Previous level"
				title="Previous level"><ChevronLeft size={18} /></a
			>
		{/if}
		{#if showNav && nextHref}
			<a
				href={resolve(nextHref as Pathname)}
				class="chrome-control level-navigation"
				aria-label="Next level"
				title="Next level"><ChevronRight size={18} /></a
			>
		{/if}
		{#if searching}
			<button
				type="button"
				onclick={cancelQueue}
				class="chrome-control search-control"
				aria-label="Cancel battle search"
				title="Cancel battle search"
			>
				<Swords size={16} /><span>Finding rival</span>
			</button>
		{/if}
		<a
			href={resolve('/leaderboard')}
			class="chrome-control desktop-nav"
			data-active={activePage === 'leaderboard'}
			aria-current={activePage === 'leaderboard' ? 'page' : undefined}
			aria-label="Leaderboard"
			title="Leaderboard"><Trophy size={17} /></a
		>
		<a
			href={resolve('/about')}
			class="chrome-control desktop-nav"
			data-active={activePage === 'about'}
			aria-current={activePage === 'about' ? 'page' : undefined}
			aria-label="How MacMac works"
			title="How MacMac works"><Info size={17} /></a
		>
		<details class="mobile-nav">
			<summary
				class="chrome-control"
				aria-label={searching ? 'More navigation, battle search active' : 'More navigation'}
				><MoreHorizontal size={18} />{#if searching}<span
						class="search-indicator"
						aria-hidden="true"
					></span>{/if}</summary
			>
			<div class="mobile-nav-menu">
				{#if showNav && prevHref}<a href={resolve(prevHref as Pathname)}
						><ChevronLeft size={18} /> Previous level</a
					>{/if}
				{#if showNav && nextHref}<a href={resolve(nextHref as Pathname)}
						><ChevronRight size={18} /> Next level</a
					>{/if}
				{#if searching}<button type="button" onclick={cancelQueue}
						><Swords size={16} /> Cancel battle search</button
					>{/if}
				<a href={resolve('/leaderboard')}><Trophy size={16} /> Leaderboard</a>
				<a href={resolve('/about')}><Info size={16} /> How MacMac works</a>
			</div>
		</details>
		<SoundButton size="sm" />
		<ThemeToggle />
		<div class="account-control"><UserAvatar /></div>
	</nav>
</header>

<style>
	.game-chrome {
		position: relative;
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		width: 100%;
		padding: 15px clamp(16px, 3vw, 40px);
	}
	.wordmark {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		min-height: 44px;
		font-family: 'Believe Stronger', sans-serif;
		font-size: 24px;
		font-weight: normal;
		letter-spacing: normal;
		text-decoration: none;
	}
	.wordmark:hover {
		opacity: 0.8;
	}

	.chrome-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.chrome-control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		flex-shrink: 0;

		border-radius: 11px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.chrome-control:hover {
		color: var(--text-primary);
		background: var(--surface);
	}
	.chrome-control[data-active='true'] {
		background: var(--surface);

		color: var(--accent-cyan);
	}
	.wordmark:focus-visible {
		outline: none;
		text-decoration: underline;
		text-underline-offset: 5px;
	}
	.chrome-control:focus-visible,
	.mobile-nav-menu a:focus-visible,
	.mobile-nav-menu button:focus-visible {
		outline: none;
		background: var(--accent-cyan);
		color: var(--on-accent);
	}

	.search-control {
		width: auto;
		padding: 0 12px;
		gap: 8px;
		color: var(--accent-orange);
		font-size: 11px;
		font-weight: 600;
	}
	.mobile-nav {
		display: none;
		position: static;
	}
	.mobile-nav summary {
		list-style: none;
	}
	.mobile-nav summary::-webkit-details-marker {
		display: none;
	}
	.mobile-nav-menu {
		position: absolute;
		right: 12px;
		top: calc(100% + 4px);
		z-index: 65;
		width: 210px;

		border-radius: 12px;
		padding: 7px;
		background: var(--surface);
		box-shadow: 0 12px 40px #0003;
	}
	.mobile-nav-menu a,
	.mobile-nav-menu button {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		width: 100%;
		border: 0;
		background: transparent;
		text-align: left;
		padding: 0 10px;
		color: var(--text-secondary);
		font-size: 12px;
		border-radius: 7px;
	}
	.mobile-nav-menu a:hover,
	.mobile-nav-menu button:hover {
		background: var(--surface-raised);
		color: var(--text-primary);
	}
	@media (max-width: 639px) {
		.game-chrome {
			gap: 10px;
			padding: 10px 12px;
		}
		.chrome-actions {
			gap: 4px;
		}
		.desktop-nav,
		.level-navigation,
		.search-control {
			display: none;
		}
		.mobile-nav {
			display: block;
		}
	}
	@media (max-width: 359px) {
		.game-chrome {
			padding-inline: 10px;
		}
	}
	.search-indicator {
		position: absolute;
		top: 5px;
		right: 5px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent-orange);
	}
	.mobile-nav summary {
		position: relative;
	}
</style>
