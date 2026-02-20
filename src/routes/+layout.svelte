<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" />
	<meta name="theme-color" content="#0a0a1a" />
	<meta property="og:type" content="website" />
	<meta property="og:image" content="https://macmac-gilt.vercel.app/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:image" content="https://macmac-gilt.vercel.app/og-image.png" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@700&display=swap"
		rel="stylesheet"
	/>
	<!-- Initialize theme before paint to avoid flash -->
	{@html `<script>
		(function() {
			var t = localStorage.getItem('macmac-theme');
			if (t === 'dark' || (!t)) document.documentElement.classList.add('dark');
		})();
	<\/script>`}
</svelte:head>

<div class="min-h-dvh" style="background: var(--bg); color: var(--text-primary);">
	{@render children()}
</div>
