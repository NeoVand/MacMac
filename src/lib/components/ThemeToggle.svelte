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
	class="flex h-8 w-8 items-center justify-center rounded-full transition"
	style="background: var(--border); color: var(--text-secondary);"
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if isDark}
		<Sun size={15} />
	{:else}
		<Moon size={15} />
	{/if}
</button>
