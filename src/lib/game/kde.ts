/**
 * Kernel Density Estimation with Gaussian kernel.
 * Bandwidth uses Silverman's rule, with narrow defaults for small n.
 */
export function computeKDE(samples: number[], evalPoints: number[]): number[] {
	const n = samples.length;
	if (n === 0) return evalPoints.map(() => 0);

	const bandwidth = silvermanBandwidth(samples);
	const invH = 1 / bandwidth;
	const coeff = invH / (n * Math.sqrt(2 * Math.PI));

	return evalPoints.map((x) => {
		let sum = 0;
		for (let i = 0; i < n; i++) {
			const z = (x - samples[i]) * invH;
			sum += Math.exp(-0.5 * z * z);
		}
		return coeff * sum;
	});
}

function silvermanBandwidth(samples: number[]): number {
	const n = samples.length;
	if (n === 1) return 0.2;
	if (n <= 3) return 0.25;

	const mean = samples.reduce((a, b) => a + b, 0) / n;
	const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
	const std = Math.sqrt(variance);

	const sorted = [...samples].sort((a, b) => a - b);
	const q1 = sorted[Math.floor(n * 0.25)];
	const q3 = sorted[Math.floor(n * 0.75)];
	const iqr = q3 - q1;

	const spread = Math.min(std, iqr / 1.34);
	return Math.max(0.05, 0.9 * (spread || std || 0.3) * Math.pow(n, -0.2));
}
