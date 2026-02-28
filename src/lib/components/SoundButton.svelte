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
		size === 'sm' ? 'h-9 w-9' : size === 'md' ? 'h-11 w-11' : 'h-10 w-10 sm:h-[46px] sm:w-[46px]'
	);
	const iconSize = $derived(size === 'sm' ? 16 : size === 'md' ? 18 : 18);
	const visualizerSize = $derived(size === 'sm' ? 'h-5 w-5' : size === 'md' ? 'h-6 w-6' : 'h-5 w-5 sm:h-6 sm:w-6');
</script>

{#if size === 'lg'}
	<!-- Landing page: 3D press-style matching the action buttons, but circular -->
	<button
		onclick={toggleAudio}
		class="btn-action btn-music cursor-pointer !rounded-full"
		aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
	>
		<span class="btn-action-face !rounded-full {sizeClasses} !p-0 items-center justify-center">
			{#if isMuted}
				<svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M9 18V5l12-2v13" />
					<circle cx="6" cy="18" r="3" />
					<circle cx="18" cy="16" r="3" />
				</svg>
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
		</span>
	</button>
{:else}
	<!-- Header: simple circle button -->
	<button
		onclick={toggleAudio}
		class="btn-music cursor-pointer relative z-10 flex {sizeClasses} items-center justify-center overflow-visible rounded-full active:scale-[0.98]"
		style="background: var(--surface); color: var(--btn-color);"
		aria-label={isMuted ? 'Turn sound on' : 'Turn sound off'}
	>
		{#if isMuted}
			<Music size={iconSize} />
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
{/if}

<style>
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
