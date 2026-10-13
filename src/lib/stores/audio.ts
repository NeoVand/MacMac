import { writable } from 'svelte/store';

export interface AudioState {
	/** Music preference. Effects have a separate control below. */
	isMuted: boolean;
	effectsMuted: boolean;
	isPlaying: boolean;
	volume: number;
	bass: number;
	mid: number;
	high: number;
	beat: number;
	beatDetected: boolean;
}

const MUSIC_STORAGE_KEY = 'macmac-audio-muted';
const EFFECTS_STORAGE_KEY = 'macmac-effects-muted';
let preferencesLoaded = false;

export const audioState = writable<AudioState>({
	isMuted: true,
	effectsMuted: false,
	isPlaying: false,
	volume: 0,
	bass: 0,
	mid: 0,
	high: 0,
	beat: 0,
	beatDetected: false
});

/** Restore after mount so SSR and the first hydration render use the same defaults. */
export function restoreAudioPreferences() {
	if (preferencesLoaded || typeof window === 'undefined') return;
	preferencesLoaded = true;
	try {
		audioState.update((state) => ({
			...state,
			isMuted: localStorage.getItem(MUSIC_STORAGE_KEY) !== 'false',
			effectsMuted: localStorage.getItem(EFFECTS_STORAGE_KEY) === 'true'
		}));
	} catch {
		// Audio still works when browser storage is unavailable.
	}
}

export function setAudioPreference(kind: 'music' | 'effects', muted: boolean) {
	const field = kind === 'music' ? 'isMuted' : 'effectsMuted';
	audioState.update((state) => ({ ...state, [field]: muted }));
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(kind === 'music' ? MUSIC_STORAGE_KEY : EFFECTS_STORAGE_KEY, String(muted));
	} catch {
		// The preference remains effective for this session.
	}
}
