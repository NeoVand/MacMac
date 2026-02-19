import { gaussian, uniform, exponential, chiSquared, mixturePdf } from './math';

export interface Level {
	id: number;
	name: string;
	subtitle: string;
	difficulty: 'easy' | 'medium' | 'hard' | 'expert';
	pdf: (x: number) => number;
	xRange: [number, number];
	numBins: number;
}

export const levels: Level[] = [
	{
		id: 1,
		name: 'The Bell Curve',
		subtitle: 'A gentle start',
		difficulty: 'easy',
		pdf: (x) => gaussian(x, 0, 1),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 2,
		name: 'Flat Land',
		subtitle: 'Equally likely everywhere',
		difficulty: 'easy',
		pdf: (x) => uniform(x, -2, 2),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 3,
		name: 'The Slide',
		subtitle: 'Fast decay to the right',
		difficulty: 'easy',
		pdf: (x) => exponential(x, 1.5),
		xRange: [-0.5, 5],
		numBins: 40
	},
	{
		id: 4,
		name: 'Lean Right',
		subtitle: 'A skewed perspective',
		difficulty: 'medium',
		pdf: (x) => chiSquared(x, 4),
		xRange: [-0.5, 15],
		numBins: 45
	},
	{
		id: 5,
		name: 'Twin Peaks',
		subtitle: 'Two modes to find',
		difficulty: 'medium',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.5, pdf: (v) => gaussian(v, -2, 0.8) },
				{ weight: 0.5, pdf: (v) => gaussian(v, 2, 0.8) }
			]),
		xRange: [-5, 5],
		numBins: 45
	},
	{
		id: 6,
		name: 'The Comb',
		subtitle: 'Three teeth to fill',
		difficulty: 'hard',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.3, pdf: (v) => gaussian(v, -3, 0.5) },
				{ weight: 0.4, pdf: (v) => gaussian(v, 0, 0.6) },
				{ weight: 0.3, pdf: (v) => gaussian(v, 3, 0.5) }
			]),
		xRange: [-6, 6],
		numBins: 50
	},
	{
		id: 7,
		name: 'The Skyscraper',
		subtitle: 'One giant among dwarfs',
		difficulty: 'hard',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.6, pdf: (v) => gaussian(v, 0, 0.2) },
				{ weight: 0.25, pdf: (v) => gaussian(v, -2, 1.5) },
				{ weight: 0.15, pdf: (v) => gaussian(v, 3, 1.0) }
			]),
		xRange: [-6, 7],
		numBins: 55
	},
	{
		id: 8,
		name: 'The Gauntlet',
		subtitle: 'Only the worthy survive',
		difficulty: 'expert',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.08, pdf: (v) => gaussian(v, -6, 0.25) },
				{ weight: 0.22, pdf: (v) => gaussian(v, -3, 1.2) },
				{ weight: 0.35, pdf: (v) => gaussian(v, 0, 0.15) },
				{ weight: 0.15, pdf: (v) => uniform(v, 2, 5) },
				{ weight: 0.2, pdf: (v) => gaussian(v, 7, 0.6) }
			]),
		xRange: [-8, 9],
		numBins: 60
	}
];

export function getLevel(id: number): Level | undefined {
	return levels.find((l) => l.id === id);
}
