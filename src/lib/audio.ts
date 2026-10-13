import { get, writable } from 'svelte/store';
import { audioState, restoreAudioPreferences, setAudioPreference } from '$lib/stores/audio';

const AUDIO_PATH = '/music/bg.mp3';
const MUSIC_VOLUME = 0.35;
const IDLE_PATH = 'M 0 50 L 100 50';
const MAX_VOICES = 24;

let context: AudioContext | null = null;
let effectsGain: GainNode | null = null;
let musicGain: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let frequencyData: Uint8Array<ArrayBuffer> | null = null;
let music: HTMLAudioElement | null = null;
let musicSource: MediaElementAudioSourceNode | null = null;
let visualizerFrame: number | null = null;
let musicPauseTimer: ReturnType<typeof setTimeout> | undefined;
let musicPlayPending = false;
let initialized = false;
let unlocked = false;
let lastVisualizerTime = 0;
let phase = 0;
let lastSampleAt = -Infinity;
const voices = new Set<OscillatorNode>();

export const visualizerPath = writable(IDLE_PATH);

function stopVisualizer() {
	if (visualizerFrame !== null) cancelAnimationFrame(visualizerFrame);
	visualizerFrame = null;
	visualizerPath.set(IDLE_PATH);
	audioState.update((state) => ({
		...state,
		isPlaying: false,
		volume: 0,
		bass: 0,
		mid: 0,
		high: 0
	}));
}

function updateVisualizer(time: number) {
	visualizerFrame = null;
	if (
		!analyser ||
		!frequencyData ||
		!music ||
		music.paused ||
		document.hidden ||
		get(audioState).isMuted
	) {
		stopVisualizer();
		return;
	}
	if (time - lastVisualizerTime >= 32) {
		lastVisualizerTime = time;
		analyser.getByteFrequencyData(frequencyData);
		const average = (from: number, to: number) => {
			let sum = 0;
			for (let i = from; i < to; i++) sum += frequencyData![i];
			return sum / ((to - from) * 255);
		};
		const bass = average(0, 4);
		const mid = average(4, 64);
		const high = average(64, frequencyData.length);
		audioState.update((state) => ({
			...state,
			isPlaying: true,
			volume: (bass + mid + high) / 3,
			bass,
			mid,
			high
		}));
		phase += 0.09;
		const amplitude = 5 + mid * 22 + high * 14;
		let path = 'M 0 50';
		for (const direction of [1, -1]) {
			for (let i = 0; i <= 24; i++) {
				const x = direction === 1 ? i / 24 : 1 - i / 24;
				const wave = (Math.sin(x * 12 + phase) * 0.65 + Math.sin(x * 6 - phase) * 0.35) * amplitude;
				path += ` L ${x * 100} ${50 + direction * wave * Math.sin(x * Math.PI)}`;
			}
		}
		visualizerPath.set(`${path} Z`);
	}
	visualizerFrame = requestAnimationFrame(updateVisualizer);
}

function startVisualizer() {
	if (visualizerFrame === null && analyser)
		visualizerFrame = requestAnimationFrame(updateVisualizer);
}

function createContext() {
	if (context || typeof window === 'undefined') return context;
	const Context =
		window.AudioContext ||
		(window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Context) return null;
	try {
		context = new Context();
		effectsGain = context.createGain();
		effectsGain.gain.value = get(audioState).effectsMuted ? 0 : 0.4;
		effectsGain.connect(context.destination);
	} catch {
		context = null;
	}
	return context;
}

function ensureMusic() {
	if (music) return;
	music = new Audio(AUDIO_PATH);
	music.loop = true;
	music.preload = 'none';
	music.volume = MUSIC_VOLUME;
	music.addEventListener('pause', stopVisualizer);
	music.addEventListener('error', stopVisualizer);
	if (!context) return;
	try {
		musicGain = context.createGain();
		musicGain.gain.value = MUSIC_VOLUME;
		music.volume = 1;
		analyser = context.createAnalyser();
		analyser.fftSize = 512;
		analyser.smoothingTimeConstant = 0.7;
		frequencyData = new Uint8Array(analyser.frequencyBinCount);
		musicSource = context.createMediaElementSource(music);
		musicSource.connect(musicGain);
		musicGain.connect(analyser);
		analyser.connect(context.destination);
	} catch {
		// Plain HTML audio remains available if the Web Audio graph is unsupported.
		music.volume = MUSIC_VOLUME;
		musicGain = null;
		analyser = null;
		frequencyData = null;
	}
}

function syncMusic() {
	if (!unlocked || typeof document === 'undefined') return;
	if (musicPauseTimer) clearTimeout(musicPauseTimer);
	musicPauseTimer = undefined;
	if (get(audioState).isMuted || document.hidden) {
		if (musicGain && context && !document.hidden) {
			musicGain.gain.cancelScheduledValues(context.currentTime);
			musicGain.gain.setTargetAtTime(0, context.currentTime, 0.035);
			musicPauseTimer = setTimeout(() => {
				music?.pause();
				musicPauseTimer = undefined;
			}, 150);
		} else {
			music?.pause();
		}
		stopVisualizer();
		return;
	}
	ensureMusic();
	if (musicGain && context) {
		musicGain.gain.cancelScheduledValues(context.currentTime);
		musicGain.gain.setTargetAtTime(MUSIC_VOLUME, context.currentTime, 0.05);
	}
	if (!music?.paused) {
		startVisualizer();
		return;
	}
	if (musicPlayPending) return;
	musicPlayPending = true;
	void music
		.play()
		.then(() => {
			if (get(audioState).isMuted || document.hidden) {
				music?.pause();
				return;
			}
			audioState.update((state) => ({ ...state, isPlaying: true }));
			startVisualizer();
		})
		.catch(() => {
			stopVisualizer();
		})
		.finally(() => {
			musicPlayPending = false;
		});
}

function stopEffects() {
	for (const oscillator of voices) {
		try {
			oscillator.stop();
		} catch {
			/* Already stopped. */
		}
	}
}

/** Load settings without attempting autoplay; each graph and listener is installed once. */
export function initAudio() {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;
	restoreAudioPreferences();
	document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
	document.addEventListener('keydown', unlockAudio, { capture: true });
	document.addEventListener('visibilitychange', () => {
		if (document.hidden) {
			stopEffects();
			syncMusic();
			if (context?.state === 'running') void context.suspend().catch(() => {});
		} else if (unlocked) {
			if (context?.state === 'suspended') void context.resume().catch(() => {});
			syncMusic();
		}
	});
}

/** Call during a click, tap or key press before automated countdowns begin. */
export function unlockAudio() {
	if (typeof window === 'undefined') return;
	initAudio();
	unlocked = true;
	if (!get(audioState).effectsMuted || !get(audioState).isMuted) createContext();
	if (context?.state === 'suspended') void context.resume().catch(() => {});
	syncMusic();
}

export function toggleAudio() {
	unlockAudio();
	setAudioPreference('music', !get(audioState).isMuted);
	syncMusic();
}

export function toggleEffects() {
	unlockAudio();
	const muted = !get(audioState).effectsMuted;
	setAudioPreference('effects', muted);
	if (effectsGain && context)
		effectsGain.gain.setTargetAtTime(muted ? 0 : 0.4, context.currentTime, 0.015);
	if (muted) stopEffects();
	else {
		createContext();
		playSample(0.5);
	}
}

function tone(
	frequency: number,
	delay = 0,
	duration = 0.18,
	volume = 0.2,
	type: OscillatorType = 'sine',
	endFrequency?: number
) {
	if (
		!context ||
		!effectsGain ||
		get(audioState).effectsMuted ||
		document.hidden ||
		voices.size >= MAX_VOICES
	)
		return;
	try {
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		const time = context.currentTime + delay;
		oscillator.type = type;
		oscillator.frequency.setValueAtTime(frequency, time);
		if (endFrequency)
			oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
		gain.gain.setValueAtTime(0, time);
		gain.gain.linearRampToValueAtTime(volume, time + 0.007);
		gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
		oscillator.connect(gain);
		gain.connect(effectsGain);
		voices.add(oscillator);
		oscillator.onended = () => {
			voices.delete(oscillator);
			oscillator.disconnect();
			gain.disconnect();
		};
		oscillator.start(time);
		oscillator.stop(time + duration + 0.025);
	} catch {
		// Sound is optional; a browser audio failure must never interrupt a game.
	}
}

/** A quiet pentatonic pluck; pitch follows the sample's position across the chart. */
export function playSample(position01 = 0.5) {
	unlockAudio();
	if (!context || context.currentTime - lastSampleAt < 0.035) return;
	lastSampleAt = context.currentTime;
	const notes = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880];
	const position = Number.isFinite(position01) ? Math.max(0, Math.min(1, position01)) : 0.5;
	const frequency = notes[Math.round(position * (notes.length - 1))];
	tone(frequency, 0, 0.17, 0.2);
	tone(frequency * 2, 0, 0.09, 0.035);
}

export function playUndo() {
	unlockAudio();
	tone(440, 0, 0.14, 0.13, 'sine', 293.66);
}
export function playReset() {
	unlockAudio();
	tone(523.25, 0, 0.2, 0.12, 'sine', 261.63);
	tone(392, 0.06, 0.17, 0.08);
}
export function playCountdown(secondsLeft: number) {
	tone(secondsLeft <= 3 ? 880 : 659.25, 0, 0.07, 0.1);
}
export function playRoundStart() {
	tone(392, 0, 0.16);
	tone(523.25, 0.09, 0.25);
}
export function playSuccess() {
	[523.25, 659.25, 783.99].forEach((frequency, i) => tone(frequency, i * 0.085, 0.3, 0.13));
}
export function playOutcome(outcome: 'win' | 'loss' | 'draw') {
	if (outcome === 'win') {
		playSuccess();
		tone(1046.5, 0.27, 0.45, 0.13);
	} else if (outcome === 'loss') {
		tone(392, 0, 0.22, 0.12);
		tone(329.63, 0.15, 0.35, 0.1);
	} else {
		tone(440, 0, 0.22, 0.12);
		tone(523.25, 0.14, 0.32, 0.1);
	}
}
