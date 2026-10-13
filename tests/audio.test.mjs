import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let audio;
let audioState;
const storage = new Map();
const listeners = new Map();
const frames = new Map();
const contexts = [];
const oscillators = [];
const musicElements = [];
let nextFrame = 1;

class AudioParam {
	value = 0;
	setValueAtTime(value) {
		this.value = value;
	}
	linearRampToValueAtTime(value) {
		this.value = value;
	}
	exponentialRampToValueAtTime(value) {
		this.value = value;
	}
	setTargetAtTime(value) {
		this.value = value;
	}
	cancelScheduledValues() {}
}

class AudioNode {
	gain = new AudioParam();
	frequency = new AudioParam();
	connected = false;
	connect() {
		this.connected = true;
	}
	disconnect() {
		this.connected = false;
	}
}

class Oscillator extends AudioNode {
	ended = false;
	constructor() {
		super();
		oscillators.push(this);
	}
	start() {}
	stop(time) {
		if (time === undefined) this.end();
	}
	end() {
		this.ended = true;
		this.onended?.();
	}
}

class Context {
	state = 'suspended';
	currentTime = 0;
	destination = {};
	mediaSources = 0;
	constructor() {
		contexts.push(this);
	}
	createGain() {
		return new AudioNode();
	}
	createOscillator() {
		return new Oscillator();
	}
	createAnalyser() {
		return { ...new AudioNode(), frequencyBinCount: 256, connect() {}, getByteFrequencyData() {} };
	}
	createMediaElementSource() {
		this.mediaSources++;
		return new AudioNode();
	}
	resume() {
		this.state = 'running';
		return Promise.resolve();
	}
	suspend() {
		this.state = 'suspended';
		return Promise.resolve();
	}
}

class Music {
	paused = true;
	playCount = 0;
	constructor() {
		musicElements.push(this);
	}
	addEventListener() {}
	play() {
		this.playCount++;
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
}

function state() {
	let value;
	const unsubscribe = audioState.subscribe((next) => {
		value = next;
	});
	unsubscribe();
	return value;
}

before(async () => {
	vite = await createServer({
		server: { middlewareMode: true, hmr: false, ws: false },
		appType: 'custom'
	});
	audio = await vite.ssrLoadModule('/src/lib/audio.ts');
	({ audioState } = await vite.ssrLoadModule('/src/lib/stores/audio.ts'));
});

after(async () => {
	if (globalThis.document) {
		document.hidden = true;
		listeners.get('visibilitychange')?.();
	}
	await vite?.close();
	for (const key of [
		'window',
		'document',
		'localStorage',
		'Audio',
		'requestAnimationFrame',
		'cancelAnimationFrame'
	])
		delete globalThis[key];
});

test('server import and initialization never access browser audio APIs', () => {
	assert.doesNotThrow(() => {
		audio.initAudio();
		audio.unlockAudio();
		audio.playSample(0.5);
	});
	assert.equal(contexts.length, 0);
	assert.equal(state().isMuted, true);
	assert.equal(state().effectsMuted, false);
});

test('restored mute choices are respected before the first user gesture', () => {
	storage.set('macmac-effects-muted', 'true');
	storage.set('macmac-audio-muted', 'true');
	globalThis.window = { AudioContext: Context };
	globalThis.document = {
		hidden: false,
		addEventListener: (name, callback) => listeners.set(name, callback)
	};
	globalThis.localStorage = {
		getItem: (key) => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value)
	};
	globalThis.Audio = Music;
	globalThis.requestAnimationFrame = (callback) => {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	};
	globalThis.cancelAnimationFrame = (id) => frames.delete(id);
	audio.initAudio();
	audio.initAudio();
	assert.equal(listeners.size, 3);
	assert.equal(contexts.length, 0);
	listeners.get('pointerdown')();
	assert.equal(contexts.length, 0, 'fully muted players do not allocate an audio graph');
	assert.equal(musicElements.length, 0, 'music is never loaded or played by a muted gesture');
});

test('effects unlock from a gesture, persist separately, and bound overlapping voices', () => {
	audio.toggleEffects();
	assert.equal(state().effectsMuted, false);
	assert.equal(state().isMuted, true);
	assert.equal(storage.get('macmac-effects-muted'), 'false');
	assert.equal(contexts.length, 1);
	assert.equal(musicElements.length, 0);
	for (let i = 0; i < 50; i++) {
		contexts[0].currentTime += 0.05;
		audio.playSample(i / 50);
	}
	assert.equal(oscillators.length, 24);
	assert.ok(oscillators.every((oscillator) => oscillator.connected));
	audio.toggleEffects();
	assert.ok(oscillators.every((oscillator) => oscillator.ended && !oscillator.connected));
	assert.equal(storage.get('macmac-effects-muted'), 'true');
	const count = oscillators.length;
	audio.playOutcome('win');
	assert.equal(oscillators.length, count, 'mute prevents automated sounds too');
});

test('music uses one graph and visualizer across repeated toggles and backgrounding', async () => {
	audio.toggleAudio();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(musicElements.length, 1);
	assert.equal(contexts.length, 1);
	assert.equal(contexts[0].mediaSources, 1);
	assert.equal(frames.size, 1);
	assert.equal(state().isPlaying, true);
	assert.equal(state().effectsMuted, true);
	for (let i = 0; i < 10; i++) {
		audio.toggleAudio();
		audio.toggleAudio();
	}
	assert.equal(frames.size, 1, 'a rapid unmute resumes exactly one animation');
	// A rapid unmute while music is still fading must restart exactly one visualizer.
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(musicElements.length, 1);
	assert.equal(contexts[0].mediaSources, 1);
	document.hidden = true;
	listeners.get('visibilitychange')();
	assert.equal(musicElements[0].paused, true);
	assert.equal(frames.size, 0);
	assert.equal(contexts[0].state, 'suspended');
	document.hidden = false;
	listeners.get('visibilitychange')();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(frames.size, 1);
	assert.equal(contexts[0].state, 'running');
});
