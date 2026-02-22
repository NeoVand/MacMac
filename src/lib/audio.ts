import { writable, get } from 'svelte/store';
import { audioState } from '$lib/stores/audio';

let audio: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let gainNode: GainNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let animationFrameId: number | null = null;

let phase = 0;
let smoothBass = 0;
let smoothHigh = 0;

export const visualizerPath = writable<string>('M 0 50 L 100 50');

const AUDIO_PATH = '/music/bg.mp3';

function initAudioContext() {
	if (audioContext || !audio) return;

	const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	audioContext = new AudioContextClass();

	analyser = audioContext.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0;

	gainNode = audioContext.createGain();

	if (audio) {
		sourceNode = audioContext.createMediaElementSource(audio);
		sourceNode.connect(gainNode);
		gainNode.connect(analyser);
		analyser.connect(audioContext.destination);
	}

	audioState.update((s) => ({ ...s, isPlaying: true }));
	updateVisualizer();
}

function updateVisualizer() {
	const muted = get(audioState).isMuted;

	if (!analyser || muted || audio?.paused) {
		visualizerPath.set('M 0 50 Q 50 50 100 50');
		audioState.update((s) => ({ ...s, isPlaying: false }));
		if (animationFrameId != null) {
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
		return;
	}

	const bufferLength = analyser.frequencyBinCount;
	const dataArray = new Uint8Array(bufferLength);
	analyser.getByteFrequencyData(dataArray);

	const bassEnd = 4;
	const midEnd = 64;

	let bassSum = 0;
	let midSum = 0;
	let highSum = 0;
	for (let i = 0; i < bufferLength; i++) {
		if (i < bassEnd) bassSum += dataArray[i];
		else if (i < midEnd) midSum += dataArray[i];
		else highSum += dataArray[i];
	}

	const bassAvg = bassSum / bassEnd;
	const midAvg = midSum / (midEnd - bassEnd);
	const highAvg = highSum / (bufferLength - midEnd);

	const nBass = bassAvg / 255;
	const nMid = midAvg / 255;
	const nHigh = highAvg / 255;

	audioState.update((s) => ({
		...s,
		volume: (nBass + nMid + nHigh) / 3,
		bass: nBass,
		mid: nMid,
		high: nHigh
	}));

	const targetMid = Math.max(0, nMid - 0.1) * 0.5;
	const targetHigh = nHigh * 8.0;

	const smooth = (current: number, target: number, attack: number, decay: number) =>
		target > current ? current + (target - current) * attack : current + (target - current) * decay;

	smoothBass = smooth(smoothBass, targetMid, 0.8, 0.1);
	smoothHigh = smooth(smoothHigh, targetHigh, 0.8, 0.15);

	phase += 0.05;
	const volume = 0.3 + smoothBass * 0.8 + smoothHigh * 2.0;

	const width = 100;
	const points = 32;
	const ampScale = 1.25;
	let path = 'M 0 50';

	for (let i = 0; i <= points; i++) {
		const normX = i / points;
		const window = Math.sin(normX * Math.PI);
		const yOffset =
			(Math.sin(normX * 6 + phase) * 14 + Math.sin(normX * 12 + phase * 1.5) * 45) * volume * ampScale;
		const y = 50 - yOffset * window;
		const x = normX * width;
		path += ` L ${x} ${y}`;
	}
	for (let i = points; i >= 0; i--) {
		const normX = i / points;
		const window = Math.sin(normX * Math.PI);
		const yOffset =
			(Math.sin(normX * 6 + phase) * 14 + Math.sin(normX * 12 + phase * 1.5) * 45) * volume * ampScale;
		const y = 50 + yOffset * window;
		const x = normX * width;
		path += ` L ${x} ${y}`;
	}
	path += ' Z';

	visualizerPath.set(path);
	animationFrameId = requestAnimationFrame(updateVisualizer);
}

function fadeVolume(target: number, onComplete?: () => void) {
	if (!gainNode && !audio) return;

	const start = gainNode ? gainNode.gain.value : (audio?.volume ?? 1);
	const diff = target - start;
	const duration = 600;
	const stepTime = 30;
	const steps = duration / stepTime;
	const stepValue = diff / steps;
	let currentStep = 0;

	const interval = setInterval(() => {
		currentStep++;
		const newVolume = Math.max(0, Math.min(1, start + stepValue * currentStep));
		if (gainNode) gainNode.gain.value = newVolume;
		else if (audio) audio.volume = newVolume;

		if (currentStep >= steps) {
			clearInterval(interval);
			if (gainNode) gainNode.gain.value = target;
			else if (audio) audio.volume = target;
			onComplete?.();
		}
	}, stepTime);
}

export function initAudio() {
	if (audio) return;

	audio = new Audio(AUDIO_PATH);
	audio.loop = true;

	audio.play()
		.then(() => {
			audioState.update((s) => ({ ...s, isMuted: false }));
			initAudioContext();
			if (audioContext?.state === 'suspended') {
				audioContext.resume();
			}
		})
		.catch(() => {
			audioState.update((s) => ({ ...s, isMuted: true }));
		});
}

export function toggleAudio() {
	if (!audio) {
		initAudio();
		return;
	}

	if (!audioContext) {
		initAudioContext();
	}

	if (audioContext?.state === 'suspended') {
		audioContext.resume();
	}

	const current = get(audioState);
	const nextMuted = !current.isMuted;

	try {
		localStorage.setItem('macmac-audio-muted', String(nextMuted));
	} catch {
		/* ignore */
	}

	audioState.update((s) => ({ ...s, isMuted: nextMuted }));

	if (nextMuted) {
		fadeVolume(0, () => {
			audio?.pause();
			if (animationFrameId != null) {
				cancelAnimationFrame(animationFrameId);
				animationFrameId = null;
			}
			visualizerPath.set('M 0 50 L 100 50');
		});
	} else {
		if (gainNode) gainNode.gain.value = 0;
		audio?.play().catch(() => {
			audioState.update((s2) => ({ ...s2, isMuted: true }));
		});
		fadeVolume(1);
		updateVisualizer();
	}
}
