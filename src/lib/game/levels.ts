import { gaussian, mixturePdf } from './math';

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
		pdf: (x) => gaussian(x, 0, 1.0),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 2,
		name: 'The Lean',
		subtitle: 'A subtle tilt',
		difficulty: 'easy',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.65, pdf: (v) => gaussian(v, -0.5, 0.9) },
				{ weight: 0.35, pdf: (v) => gaussian(v, 2, 0.9) }
			]),
		xRange: [-4, 5],
		numBins: 40
	},
	{
		id: 3,
		name: 'Twin Peaks',
		subtitle: 'Two hills to find',
		difficulty: 'easy',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.5, pdf: (v) => gaussian(v, -1.5, 0.8) },
				{ weight: 0.5, pdf: (v) => gaussian(v, 1.5, 0.8) }
			]),
		xRange: [-4, 4],
		numBins: 40
	},
	{
		id: 4,
		name: 'The Shelf',
		subtitle: 'Broad meets narrow',
		difficulty: 'medium',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.4, pdf: (v) => gaussian(v, -1.5, 1.0) },
				{ weight: 0.35, pdf: (v) => gaussian(v, 2, 0.7) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 4.5, 0.7) }
			]),
		xRange: [-5, 7],
		numBins: 45
	},
	{
		id: 5,
		name: 'Triple Play',
		subtitle: 'Three modes, unequal',
		difficulty: 'medium',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.25, pdf: (v) => gaussian(v, -2.5, 0.7) },
				{ weight: 0.5, pdf: (v) => gaussian(v, 0.5, 0.7) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 3.5, 0.7) }
			]),
		xRange: [-5, 6],
		numBins: 45
	},
	{
		id: 6,
		name: 'The Comb',
		subtitle: 'Four teeth to fill',
		difficulty: 'hard',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.25, pdf: (v) => gaussian(v, -3, 0.65) },
				{ weight: 0.25, pdf: (v) => gaussian(v, -0.5, 0.65) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 2, 0.65) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 4.5, 0.65) }
			]),
		xRange: [-5.5, 7],
		numBins: 50
	},
	{
		id: 7,
		name: 'Choppy Waters',
		subtitle: 'Five waves to ride',
		difficulty: 'hard',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.15, pdf: (v) => gaussian(v, -4, 0.6) },
				{ weight: 0.25, pdf: (v) => gaussian(v, -1.5, 0.65) },
				{ weight: 0.25, pdf: (v) => gaussian(v, 1, 0.6) },
				{ weight: 0.2, pdf: (v) => gaussian(v, 3.5, 0.65) },
				{ weight: 0.15, pdf: (v) => gaussian(v, 6, 0.6) }
			]),
		xRange: [-6, 8],
		numBins: 55
	},
	{
		id: 8,
		name: 'The Gauntlet',
		subtitle: 'Six peaks, no mercy',
		difficulty: 'expert',
		pdf: (x) =>
			mixturePdf(x, [
				{ weight: 0.1, pdf: (v) => gaussian(v, -5, 0.6) },
				{ weight: 0.18, pdf: (v) => gaussian(v, -2.5, 0.6) },
				{ weight: 0.24, pdf: (v) => gaussian(v, 0, 0.6) },
				{ weight: 0.18, pdf: (v) => gaussian(v, 2.5, 0.6) },
				{ weight: 0.18, pdf: (v) => gaussian(v, 5, 0.6) },
				{ weight: 0.12, pdf: (v) => gaussian(v, 7.5, 0.6) }
			]),
		xRange: [-7, 10],
		numBins: 60
	}
];

export function getLevel(id: number): Level | undefined {
	return levels.find((l) => l.id === id);
}
