const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function gaussian(x: number, mean: number, std: number): number {
	const z = (x - mean) / std;
	return Math.exp(-0.5 * z * z) / (std * SQRT_2PI);
}

export function uniform(x: number, a: number, b: number): number {
	return x >= a && x <= b ? 1 / (b - a) : 0;
}

export function exponential(x: number, lambda: number): number {
	return x >= 0 ? lambda * Math.exp(-lambda * x) : 0;
}

export function chiSquared(x: number, k: number): number {
	if (x <= 0) return 0;
	const halfK = k / 2;
	const coeff = Math.pow(x, halfK - 1) * Math.exp(-x / 2);
	const denom = Math.pow(2, halfK) * gammaFn(halfK);
	return coeff / denom;
}

export function gammaFn(n: number): number {
	if (n === 1) return 1;
	if (n === 0.5) return Math.sqrt(Math.PI);
	if (n === 1.5) return (Math.sqrt(Math.PI) / 2);
	if (Number.isInteger(n) && n > 0) {
		let result = 1;
		for (let i = 2; i < n; i++) result *= i;
		return result;
	}
	// Stirling's approximation for non-integer values
	return Math.sqrt((2 * Math.PI) / n) * Math.pow(n / Math.E, n);
}

export function mixturePdf(
	x: number,
	components: { weight: number; pdf: (x: number) => number }[]
): number {
	return components.reduce((sum, c) => sum + c.weight * c.pdf(x), 0);
}

export function linspace(start: number, end: number, n: number): number[] {
	const step = (end - start) / (n - 1);
	return Array.from({ length: n }, (_, i) => start + i * step);
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
