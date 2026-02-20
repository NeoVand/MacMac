/**
 * Kernel Density Estimation with Gaussian kernel.
 * Bandwidth uses Scott's rule with a smoothly decaying minimum floor
 * to prevent wild jumps between consecutive sample additions.
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

function stableBandwidth(samples: number[]): number {
	const n = samples.length;

	// Compute data spread even for small n
	const mean = samples.reduce((a, b) => a + b, 0) / n;
	const variance = n > 1
		? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
		: 0;
	const std = Math.sqrt(variance);

	// Scott's rule: h = 1.06 * std * n^(-1/5)
	// More stable than Silverman's for small n (no IQR which is noisy)
	const scottH = std > 0 ? 1.06 * std * Math.pow(n, -0.2) : 0;

	// Smooth floor that starts wide and narrows as n grows
	// At n=1: floor=0.35, n=5: floor=0.2, n=20: floor=0.1, n=80: floor=0.05
	const floor = 0.35 / Math.pow(n, 0.35);

	return Math.max(floor, scottH);
}
