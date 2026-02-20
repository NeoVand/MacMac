<script lang="ts">
	import UserAvatar from './UserAvatar.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	interface Props {
		breadcrumb?: string;
		breadcrumbIcon?: 'crown' | 'info' | 'none';
		showNav?: boolean;
		prevHref?: string | null;
		nextHref?: string | null;
	}

	let { breadcrumb, breadcrumbIcon = 'none', showNav = false, prevHref = null, nextHref = null }: Props = $props();
</script>

<header class="flex shrink-0 items-center justify-between px-4 py-2 sm:px-6">
	<!-- Left: logo + breadcrumb -->
	<div class="flex items-center gap-2">
		<a href="/" class="inline-block transition hover:opacity-80" style="font-family: 'Space Grotesk', sans-serif;">
			<span class="text-base" style="color: var(--text-secondary);">mac</span><span class="text-base" style="color: var(--accent-cyan); opacity: 0.6;">mac</span>
		</a>
		{#if breadcrumb}
			<span style="color: var(--border);">/</span>
			<div class="flex items-center gap-1.5">
				{#if breadcrumbIcon === 'crown'}
					<svg viewBox="0 0 24 24" fill="#eab308" class="h-3.5 w-3.5"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
				{:else if breadcrumbIcon === 'info'}
					<svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5" style="color: var(--text-tertiary);"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clip-rule="evenodd" /></svg>
				{/if}
				<span class="text-sm font-medium" style="color: var(--text-primary); opacity: 0.7;">{breadcrumb}</span>
			</div>
		{/if}
	</div>

	<!-- Right: nav + actions -->
	<div class="flex items-center gap-1.5">
		{#if showNav && prevHref}
			<a href={prevHref} class="flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Previous">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
			</a>
		{/if}
		{#if showNav && nextHref}
			<a href={nextHref} class="flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface); color: var(--text-secondary);" aria-label="Next">
				<svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
			</a>
		{/if}
		<a href="/leaderboard" class="flex h-8 w-8 items-center justify-center rounded-full transition hover:opacity-70" style="background: var(--surface);" aria-label="Leaderboard">
			<svg viewBox="0 0 24 24" fill="#eab308" class="h-3.5 w-3.5"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6-5-4zm3 14h14v2H5v-2z" /></svg>
		</a>
		<ThemeToggle />
		<UserAvatar size="sm" />
	</div>
</header>
