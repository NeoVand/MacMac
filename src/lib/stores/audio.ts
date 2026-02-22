import { writable } from 'svelte/store';

export interface AudioState {
	isMuted: boolean;
	isPlaying: boolean;
	volume: number;
	bass: number;
	mid: number;
	high: number;
	beat: number;
	beatDetected: boolean;
}

const STORAGE_KEY = 'macmac-audio-muted';

function loadMuted(): boolean {
	if (typeof window === 'undefined') return true;
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored !== 'false'; // default muted unless explicitly false
	} catch {
		return true;
	}
}

function createAudioStore() {
	const { subscribe, set, update } = writable<AudioState>({
		isMuted: loadMuted(),
		isPlaying: false,
		volume: 0,
		bass: 0,
		mid: 0,
		high: 0,
		beat: 0,
		beatDetected: false
	});

	return {
		subscribe,
		set,
		update,
		toggleMuted: () => update((s) => ({ ...s, isMuted: !s.isMuted }))
	};
}

export const audioState = createAudioStore();
