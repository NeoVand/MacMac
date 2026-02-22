<script lang="ts">
	import { Music } from 'lucide-svelte';
	import { audioState } from '$lib/stores/audio';
	import { visualizerPath } from '$lib/audio';
	import { toggleAudio } from '$lib/audio';

	interface Props {
		size?: 'sm' | 'md' | 'lg';
	}

	let { size = 'sm' }: Props = $props();

	const isMuted = $derived($audioState.isMuted);
	const path = $derived($visualizerPath);
	const sizeClasses = $derived(
		size === 'sm' ? 'h-9 w-9' : size === 'md' ? 'h-11 w-11' : 'h-12 w-12'
	);
	const iconSize = $derived(size === 'sm' ? 16 : size === 'md' ? 18 : 20);
	const visualizerSize = $derived(size === 'sm' ? 'h-5 w-5' : size === 'md' ? 'h-6 w-6' : 'h-7 w-7');
	const buttonStyle = $derived.by(() => {
		if (size === 'lg') {
			return 'font-family: \'Outfit\', sans-serif; color: var(--accent-purple);';
		}
		return 'background: var(--surface); color: var(--accent-purple);';
	});
</script>

<button
	onclick={toggleAudio}
	class="relative z-10 flex {sizeClasses} items-center justify-center overflow-visible rounded-full transition hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] sm:hover:brightness-[1.03] dark:hover:brightness-110 {size === 'lg' ? 'sound-btn-lg' : ''}"
	style={buttonStyle}
	aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
>
	{#if isMuted}
		{#if size === 'lg'}
			<svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="url(#music-icon-grad-lg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<defs>
					<linearGradient id="music-icon-grad-lg" x1="0%" y1="0%" x2="100%" y2="0%" gradientUnits="userSpaceOnUse">
						<stop offset="0%" stop-color="var(--accent-cyan)" />
						<stop offset="100%" stop-color="var(--accent-purple)" />
					</linearGradient>
				</defs>
				<path d="M9 18V5l12-2v13" />
				<circle cx="6" cy="18" r="3" />
				<circle cx="18" cy="16" r="3" />
			</svg>
		{:else}
			<Music size={iconSize} />
		{/if}
	{:else}
		<div class="relative z-10 flex {visualizerSize} items-center justify-center waveform-vis">
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-full w-full overflow-visible">
				<defs>
					<linearGradient id="waveform-grad-{size}" x1="0%" y1="0%" x2="100%" y2="0%" gradientUnits="userSpaceOnUse">
						<stop offset="0%" stop-color="var(--accent-cyan)" />
						<stop offset="100%" stop-color="var(--accent-purple)" />
					</linearGradient>
				</defs>
				<path
					d={path}
					fill="url(#waveform-grad-{size})"
					stroke="none"
				/>
			</svg>
		</div>
	{/if}
</button>

<style>
	/* Landing page: gradient background + border (cyan → purple), very subtle - match Play/Leaderboard transparency */
	.sound-btn-lg {
		background: linear-gradient(
				to right,
				color-mix(in srgb, var(--accent-cyan) 1.5%, transparent),
				color-mix(in srgb, var(--accent-purple) 1.8%, transparent)
			)
			padding-box,
			linear-gradient(
					to right,
					color-mix(in srgb, var(--accent-cyan) 16%, transparent),
					color-mix(in srgb, var(--accent-purple) 20%, transparent)
				)
				border-box;
		border: 1px solid transparent;
		box-shadow: 0 2px 12px color-mix(in srgb, var(--accent-purple) 5%, transparent);
	}

	/* Ensure waveform renders on top */
	.waveform-vis {
		overflow: visible;
	}
	.waveform-vis svg {
		position: relative;
		z-index: 1;
	}

	/* Light mode: more transparent waveform so it doesn't stand out */
	.waveform-vis path {
		fill-opacity: 0.55;
	}
	.dark .waveform-vis path {
		fill-opacity: 0.9;
	}
</style>
