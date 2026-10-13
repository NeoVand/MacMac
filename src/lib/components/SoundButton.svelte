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
	const iconSize = $derived(size === 'sm' ? 17 : 18);

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
		class="audio-trigger"
		data-size={size}
		data-open={open}
		aria-label="Audio settings"
		aria-expanded={open}
		aria-controls="{uid}-settings"
		title="Audio settings"
	>
		<span class="audio-trigger-icon">
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
	.audio-trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;

		border-radius: 11px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.audio-trigger[data-size='lg'] {
		width: 44px;
		height: 44px;
	}
	.audio-trigger:hover,
	.audio-trigger[data-open='true'] {
		background: var(--surface);
		color: var(--text-primary);
	}
	.audio-trigger-icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.audio-control {
		position: relative;
		z-index: 60;
	}
	.audio-settings {
		position: absolute;
		right: 0;
		top: calc(100% + 10px);
		width: 250px;

		border-radius: 12px;
		padding: 12px;
		background: var(--surface);
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
		width: 44px;
		height: 44px;
		border-radius: 9px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.audio-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 12px 8px;
		border-radius: 10px;
		text-align: left;
		cursor: pointer;
	}
	.audio-option:hover,
	.close-settings:hover {
		background: var(--surface-raised);
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
		font-size: 11px;
		font-weight: 400;
		color: var(--text-secondary);
	}
	.audio-switch {
		min-width: 36px;
		padding: 4px 7px;
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-secondary);
		text-align: center;
		font-size: 11px;
		font-weight: 700;
	}
	.audio-switch[data-on='true'] {
		background: color-mix(in srgb, var(--accent-cyan) 13%, var(--surface));
		color: var(--accent-cyan);
	}
	@media (max-width: 639px) {
		.audio-settings {
			position: fixed;
			top: 72px;
			right: 14px;
			max-width: calc(100vw - 28px);
		}
	}
	button:focus-visible {
		outline: none;
		background: var(--surface-raised);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.audio-trigger:focus-visible,
	.close-settings:focus-visible {
		background: var(--accent-cyan);
		color: var(--on-accent);
		text-decoration: none;
	}
</style>
