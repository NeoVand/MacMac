<script lang="ts">
	import { Info } from 'lucide-svelte';
	import UserAvatar from './UserAvatar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import SoundButton from './SoundButton.svelte';

	interface Props {
		activePage?: 'leaderboard' | 'about' | 'none';
		showNav?: boolean;
		prevHref?: string | null;
		nextHref?: string | null;
	}

	let { activePage = 'none', showNav = false, prevHref = null, nextHref = null }: Props = $props();
</script>

<header class="flex shrink-0 items-center justify-between px-4 py-2 sm:px-6 sm:py-3">
	<!-- Left: logo -->
	<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
		<span class="text-lg" style="color: var(--text-primary); opacity: 0.85;">mac</span><span class="bg-gradient-to-r from-game-cyan to-purple-400 bg-clip-text text-lg text-transparent">mac</span>
	</a>

	<!-- Right: nav + actions -->
	<div class="flex items-center gap-2">
		{#if showNav && prevHref}
			<a href={prevHref} class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Previous">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
			</a>
		{/if}
		{#if showNav && nextHref}
			<a href={nextHref} class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Next">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-5 w-5"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
			</a>
		{/if}
		<a
			href="/leaderboard"
			class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70"
			style="background: {activePage === 'leaderboard' ? 'color-mix(in srgb, #eab308 18%, var(--surface))' : 'var(--surface)'}; {activePage === 'leaderboard' ? 'box-shadow: 0 0 0 1.5px color-mix(in srgb, #eab308 35%, transparent);' : ''}"
			aria-label="Leaderboard"
		>
			<svg viewBox="0 0 24 24" fill="#eab308" class="h-4 w-4"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
		</a>
		<SoundButton size="sm" />
		<a
			href="/about"
			class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70"
			style="background: {activePage === 'about' ? 'color-mix(in srgb, var(--accent-cyan) 15%, var(--surface))' : 'var(--surface)'}; color: {activePage === 'about' ? 'var(--accent-cyan)' : 'var(--text-secondary)'}; {activePage === 'about' ? 'box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--accent-cyan) 35%, transparent);' : ''}"
			aria-label="About"
		>
			<Info size={16} />
		</a>
		<ThemeToggle />
		<UserAvatar />
	</div>
</header>
