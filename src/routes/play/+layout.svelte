<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props();

	onMount(() => {
		document.documentElement.classList.add('play-active');
		return () => document.documentElement.classList.remove('play-active');
	});
</script>

{@render children()}
