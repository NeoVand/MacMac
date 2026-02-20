/**
 * Kernel Density Estimation with Gaussian kernel.
 * Bandwidth uses Scott's rule with a floor and a ceiling.
 * The ceiling (0.5) ensures clusters resolve into distinct peaks
 * rather than merging into one blob on multi-modal distributions.
 */
export function computeKDE(samples: number[], evalPoints: number[]): number[] {
	const n = samples.length;
	if (n === 0) return evalPoints.map(() => 0);

	const bandwidth = stableBandwidth(samples);
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

const BW_CEILING = 0.5;

function stableBandwidth(samples: number[]): number {
	const n = samples.length;

	const mean = samples.reduce((a, b) => a + b, 0) / n;
	const variance = n > 1
		? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
		: 0;
	const std = Math.sqrt(variance);

	const scottH = std > 0 ? 1.06 * std * Math.pow(n, -0.2) : 0;
	const floor = 0.35 / Math.pow(n, 0.35);

	return Math.min(Math.max(floor, scottH), BW_CEILING);
}
