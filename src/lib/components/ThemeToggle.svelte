<script lang="ts">
	import { onMount } from 'svelte';
	import { Sun, Moon } from 'lucide-svelte';

	let isDark = $state(true);
	onMount(() => {
		isDark = document.documentElement.classList.contains('dark');
	});

	function toggle() {
		isDark = !isDark;
		document.documentElement.classList.toggle('dark', isDark);
		try {
			localStorage.setItem('macmac-theme', isDark ? 'dark' : 'light');
		} catch {
			/* Keep this session's choice when storage is unavailable. */
		}
	}
</script>

<button
	type="button"
	onclick={toggle}
	class="theme-control"
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={isDark ? 'Light mode' : 'Dark mode'}
>
	{#if isDark}<Sun size={17} />{:else}<Moon size={17} />{/if}
</button>

<style>
	.theme-control {
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
	.theme-control:hover {
		color: var(--text-primary);
		background: var(--surface);
	}
	.theme-control:focus-visible {
		background: var(--accent-cyan);
		color: var(--on-accent);
		outline: none;
	}
</style>
