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
			return 'font-family: \'Outfit\', sans-serif; background: color-mix(in srgb, var(--accent-purple) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent-purple) 30%, transparent); color: var(--accent-purple); box-shadow: 0 2px 12px color-mix(in srgb, var(--accent-purple) 12%, transparent);';
		}
		return 'background: var(--surface); color: var(--text-secondary);';
	});
</script>

<button
	onclick={toggleAudio}
	class="flex {sizeClasses} items-center justify-center rounded-full transition hover:scale-[1.02] hover:opacity-90 active:scale-[0.98] sm:hover:brightness-[1.03] dark:hover:brightness-110"
	style={buttonStyle}
	aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
>
	{#if isMuted}
		<Music size={iconSize} />
	{:else}
		<div class="flex {visualizerSize} items-center justify-center opacity-90">
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
					fill-opacity="0.95"
					stroke="none"
				/>
			</svg>
		</div>
	{/if}
</button>
