/**
 * Seeded PRNG using Mulberry32.
 * Deterministic — same seed always produces the same sequence.
 * Server can reproduce any level from its seed for score verification.
 */
export class SeededRandom {
	private state: number;

	constructor(seed: number) {
		this.state = seed | 0;
	}

	/** Returns a float in [0, 1) */
	next(): number {
		this.state |= 0;
		this.state = (this.state + 0x6d2b79f5) | 0;
		let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/** Uniform float in [min, max) */
	range(min: number, max: number): number {
		return min + this.next() * (max - min);
	}

	/** Uniform integer in [min, max] (inclusive) */
	int(min: number, max: number): number {
		return Math.floor(this.range(min, max + 1));
	}

	/** Standard normal via Box-Muller, optionally with custom mean and std */
	gaussian(mean = 0, std = 1): number {
		const u1 = this.next() || 1e-10; // avoid log(0)
		const u2 = this.next();
		const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
		return mean + z * std;
	}

	/** Shuffle an array in-place (Fisher-Yates) */
	shuffle<T>(arr: T[]): T[] {
		for (let i = arr.length - 1; i > 0; i--) {
			const j = this.int(0, i);
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
}
