import { computeBandwidth } from './kde';
import { gaussian } from './math';

export interface Level {
	id: number;
	name: string;
	subtitle: string;
	difficulty: 'easy' | 'medium' | 'hard' | 'expert';
	pdf: (x: number) => number;
	xRange: [number, number];
	numBins: number;
}

function kernelTargetPdf(hiddenClicks: number[]): (x: number) => number {
	const n = hiddenClicks.length;
	const h = computeBandwidth(hiddenClicks);
	const invN = 1 / n;

	return (x: number) => {
		let sum = 0;
		for (const c of hiddenClicks) sum += gaussian(x, c, h);
		return sum * invN;
	};
}

export const levels: Level[] = [
	{
		id: 1,
		name: 'The Bell Curve',
		subtitle: 'A gentle start',
		difficulty: 'easy',
		pdf: kernelTargetPdf([0, 0.68, -0.68]),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 2,
		name: 'The Lean',
		subtitle: 'A subtle tilt',
		difficulty: 'easy',
		pdf: kernelTargetPdf([-1.55, -0.95, -0.45, 0.15, 1.05]),
		xRange: [-4, 5],
		numBins: 40
	},
	{
		id: 3,
		name: 'Twin Peaks',
		subtitle: 'Two hills to find',
		difficulty: 'easy',
		pdf: kernelTargetPdf([-2.15, -1.75, -1.35, -0.90, 0.85, 1.25, 1.70, 2.15]),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 4,
		name: 'The Shelf',
		subtitle: 'Broad meets narrow',
		difficulty: 'medium',
		pdf: kernelTargetPdf([-3.20, -2.55, -1.90, -1.25, -0.55, 0.15, 1.90, 2.20, 2.20, 2.60, 4.50, 5.05]),
		xRange: [-5, 7],
		numBins: 45
	},
	{
		id: 5,
		name: 'Triple Play',
		subtitle: 'Three modes, unequal',
		difficulty: 'medium',
		pdf: kernelTargetPdf([
			-3.05, -2.70, -2.35, -2.00, -0.35, -0.05, 0.25, 0.55, 0.55, 0.80, 1.05, 1.30, 2.95, 3.25, 3.55, 3.90
		]),
		xRange: [-5, 6],
		numBins: 45
	},
	{
		id: 6,
		name: 'The Comb',
		subtitle: 'Four teeth to fill',
		difficulty: 'hard',
		pdf: kernelTargetPdf([
			-3.65, -3.35, -3.10, -2.85, -2.55, -1.20, -0.95, -0.70, -0.70, -0.45, -0.20, 1.20, 1.45, 1.70, 1.70,
			1.95, 2.20, 3.80, 4.05, 4.30, 4.55, 4.55
		]),
		xRange: [-5.5, 7],
		numBins: 50
	},
	{
		id: 7,
		name: 'Choppy Waters',
		subtitle: 'Five waves to ride',
		difficulty: 'hard',
		pdf: kernelTargetPdf([
			-4.90, -4.55, -4.20, -4.20, -2.20, -1.95, -1.70, -1.45, -1.45, -1.20, -0.95, -0.70, 0.35, 0.60, 0.85,
			1.10, 1.10, 1.35, 1.60, 1.85, 2.95, 3.20, 3.45, 3.70, 3.70, 3.95, 5.40, 5.75, 6.10, 6.10
		]),
		xRange: [-6, 8],
		numBins: 55
	},
	{
		id: 8,
		name: 'The Gauntlet',
		subtitle: 'Six peaks, no mercy',
		difficulty: 'expert',
		pdf: kernelTargetPdf([
			-5.45, -5.20, -4.95, -4.95, -3.05, -2.80, -2.55, -2.55, -2.30, -2.05, -1.80, -0.75, -0.50, -0.25, -0.05,
			0.15, 0.35, 0.55, 0.55, 0.80, 1.05, 1.85, 2.10, 2.35, 2.35, 2.60, 2.85, 3.10, 4.25, 4.50, 4.75, 4.75,
			5.00, 5.25, 5.50, 6.95, 7.20, 7.45, 7.45, 7.70
		]),
		xRange: [-7, 10],
		numBins: 60
	}
];

export function getLevel(id: number): Level | undefined {
	return levels.find((l) => l.id === id);
}
