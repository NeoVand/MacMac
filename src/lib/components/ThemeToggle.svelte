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
		localStorage.setItem('macmac-theme', isDark ? 'dark' : 'light');
	}
</script>

<button
	onclick={toggle}
	class="flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-70"
	style="background: var(--surface); color: var(--text-secondary);"
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if isDark}
		<Sun size={16} />
	{:else}
		<Moon size={16} />
	{/if}
</button>
