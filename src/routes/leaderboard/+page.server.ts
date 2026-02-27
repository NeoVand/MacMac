import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { desc, gt } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
	// Solo tab: only players who have played at least one solo game
	// Sorted by rating (skill) instead of best score
	const bySolo = await db
		.select({
			playerName: players.playerName,
			country: players.country,
			rating: players.rating,
			bestWeightedScore: players.bestWeightedScore,
			bestScoreDifficulty: players.bestScoreDifficulty,
			gamesPlayed: players.gamesPlayed
		})
		.from(players)
		.where(gt(players.gamesPlayed, 0))
		.orderBy(desc(players.rating))
		.limit(50);

	// Battle tab: only players who have battled at least once
	const byBattle = await db
		.select({
			playerName: players.playerName,
			country: players.country,
			battleElo: players.battleElo,
			battlesPlayed: players.battlesPlayed,
			battleWins: players.battleWins
		})
		.from(players)
		.where(gt(players.battlesPlayed, 0))
		.orderBy(desc(players.battleElo))
		.limit(50);

	return { bySolo, byBattle };
};
