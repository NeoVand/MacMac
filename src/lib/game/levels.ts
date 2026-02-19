import { gaussian, uniform, exponential, chiSquared, mixturePdf } from './math';

export interface Level {
	id: number;
	name: string;
	subtitle: string;
	difficulty: 'easy' | 'medium' | 'hard' | 'expert';
	pdf: (x: number) => number;
	xRange: [number, number];
	klWeight: number;
	par: number;
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
		klWeight: 8,

		par: 25,
		numBins: 40
	},
	{
		id: 2,
		name: 'Flat Land',
		subtitle: 'Equally likely everywhere',
		difficulty: 'easy',
		pdf: (x) => uniform(x, -2, 2),
		xRange: [-4, 4],
		klWeight: 6,

		par: 20,
		numBins: 40
	},
	{
		id: 3,
		name: 'The Slide',
		subtitle: 'Fast decay to the right',
		difficulty: 'easy',
		pdf: (x) => exponential(x, 1.5),
		xRange: [-0.5, 5],
		klWeight: 7,

		par: 25,
		numBins: 40
	},
	{
		id: 4,
		name: 'Lean Right',
		subtitle: 'A skewed perspective',
		difficulty: 'medium',
		pdf: (x) => chiSquared(x, 4),
		xRange: [-0.5, 15],
		klWeight: 6,

		par: 30,
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
		klWeight: 5,

		par: 35,
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
		klWeight: 4,

		par: 45,
		numBins: 50
	},
	{
		id: 7,
		name: 'Choppy Waters',
		subtitle: 'Five peaks, no mercy',
		difficulty: 'hard',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.15, pdf: (v) => gaussian(v, -4, 0.4) },
				{ weight: 0.25, pdf: (v) => gaussian(v, -1.5, 0.5) },
				{ weight: 0.2, pdf: (v) => gaussian(v, 0.5, 0.3) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 2.5, 0.45) },
				{ weight: 0.15, pdf: (v) => gaussian(v, 5, 0.35) }
			]),
		xRange: [-6, 7],
		klWeight: 3,

		par: 55,
		numBins: 55
	},
	{
		id: 8,
		name: 'The Gauntlet',
		subtitle: 'Only the worthy survive',
		difficulty: 'expert',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.1, pdf: (v) => gaussian(v, -5, 0.3) },
				{ weight: 0.15, pdf: (v) => gaussian(v, -3, 0.7) },
				{ weight: 0.05, pdf: (v) => gaussian(v, -1, 0.2) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 0.5, 0.9) },
				{ weight: 0.1, pdf: (v) => gaussian(v, 2, 0.25) },
				{ weight: 0.2, pdf: (v) => gaussian(v, 3.5, 0.5) },
				{ weight: 0.15, pdf: (v) => gaussian(v, 6, 0.4) }
			]),
		xRange: [-7, 8],
		klWeight: 2.5,

		par: 65,
		numBins: 60
	}
];

export function getLevel(id: number): Level | undefined {
	return levels.find((l) => l.id === id);
}
