<script lang="ts">
	import { onMount } from 'svelte';
	import { Music, Volume2, VolumeX, X } from 'lucide-svelte';
	import { audioState } from '$lib/stores/audio';
	import { initAudio, toggleAudio, toggleEffects, visualizerPath } from '$lib/audio';

	interface Props {
		size?: 'sm' | 'md' | 'lg';
	}

	let { size = 'sm' }: Props = $props();
	let open = $state(false);
	let container: HTMLDivElement | undefined;
	const uid = $props.id();
	const allMuted = $derived($audioState.isMuted && $audioState.effectsMuted);
	const sizeClasses = $derived(
		size === 'sm' ? 'h-9 w-9' : size === 'md' ? 'h-11 w-11' : 'h-10 w-10 sm:h-[46px] sm:w-[46px]'
	);
	const iconSize = $derived(size === 'sm' ? 16 : 18);

	onMount(initAudio);

	function attachContainer(element: HTMLDivElement) {
		container = element;
		return () => {
			if (container === element) container = undefined;
		};
	}

	function closeOnOutside(event: PointerEvent) {
		if (open && !event.composedPath().includes(container!)) open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !open) return;
		open = false;
		container?.querySelector<HTMLButtonElement>('.audio-trigger')?.focus();
	}

	function closeOnFocusLeave(event: FocusEvent) {
		if (open && !container?.contains(event.relatedTarget as Node | null)) open = false;
	}
</script>

<svelte:window onpointerdown={closeOnOutside} onkeydown={handleKeydown} />

<div class="audio-control" {@attach attachContainer} onfocusout={closeOnFocusLeave}>
	<button
		type="button"
		onclick={() => (open = !open)}
		class="audio-trigger btn-music cursor-pointer {size === 'lg'
			? 'btn-action !rounded-full'
			: `relative flex ${sizeClasses} items-center justify-center rounded-full active:scale-[0.98]`}"
		style={size !== 'lg' ? 'background: var(--surface); color: var(--btn-color);' : ''}
		aria-label="Audio settings"
		aria-expanded={open}
		aria-controls="{uid}-settings"
		title="Audio settings"
	>
		<span
			class={size === 'lg'
				? `btn-action-face !rounded-full ${sizeClasses} items-center justify-center !p-0`
				: 'flex items-center justify-center'}
		>
			{#if $audioState.isPlaying}
				<svg
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					class="h-5 w-5 overflow-visible"
					aria-hidden="true"
				>
					<path d={$visualizerPath} fill="currentColor" fill-opacity="0.75" />
				</svg>
			{:else if allMuted}
				<VolumeX size={iconSize} aria-hidden="true" />
			{:else}
				<Volume2 size={iconSize} aria-hidden="true" />
			{/if}
		</span>
	</button>

	{#if open}
		<div class="audio-settings" id="{uid}-settings">
			<div class="audio-settings-heading">
				<span>Audio</span>
				<button
					type="button"
					onclick={() => {
						open = false;
						container?.querySelector<HTMLButtonElement>('.audio-trigger')?.focus();
					}}
					aria-label="Close audio settings"
					class="close-settings"><X size={14} /></button
				>
			</div>
			<button
				type="button"
				class="audio-option"
				onclick={toggleEffects}
				role="switch"
				aria-checked={!$audioState.effectsMuted}
				aria-label="Sound effects"
			>
				<span class="audio-option-label"
					><Volume2 size={15} /><span>Sound effects<small>Notes, countdown & wins</small></span
					></span
				>
				<span class="audio-switch" data-on={!$audioState.effectsMuted}
					>{$audioState.effectsMuted ? 'Off' : 'On'}</span
				>
			</button>
			<button
				type="button"
				class="audio-option"
				onclick={toggleAudio}
				role="switch"
				aria-checked={!$audioState.isMuted}
				aria-label="Background music"
			>
				<span class="audio-option-label"
					><Music size={15} /><span>Music<small>Background soundtrack</small></span></span
				>
				<span class="audio-switch" data-on={!$audioState.isMuted}
					>{$audioState.isMuted ? 'Off' : 'On'}</span
				>
			</button>
		</div>
	{/if}
</div>

<style>
	.audio-control {
		position: relative;
		z-index: 60;
	}
	.audio-settings {
		position: absolute;
		right: 0;
		top: calc(100% + 10px);
		width: 250px;
		border: 1px solid var(--border);
		border-radius: 16px;
		padding: 12px;
		background: var(--bg);
		color: var(--text-primary);
		box-shadow: 0 16px 50px #0003;
	}
	.audio-settings-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 4px 8px;
		font-size: 12px;
		font-weight: 700;
	}
	.close-settings {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.audio-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 10px 6px;
		border-radius: 10px;
		text-align: left;
		cursor: pointer;
	}
	.audio-option:hover,
	.close-settings:hover {
		background: var(--surface);
	}
	.audio-option-label {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		font-weight: 600;
	}
	.audio-option-label small {
		display: block;
		margin-top: 3px;
		font-size: 10px;
		font-weight: 400;
		color: var(--text-tertiary);
	}
	.audio-switch {
		min-width: 36px;
		padding: 4px 7px;
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-tertiary);
		text-align: center;
		font-size: 10px;
		font-weight: 700;
	}
	.audio-switch[data-on='true'] {
		background: color-mix(in srgb, var(--accent-cyan) 13%, var(--surface));
		color: var(--accent-cyan);
	}
	button:focus-visible {
		outline: 2px solid var(--accent-cyan);
		outline-offset: 3px;
	}
</style>
