import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/** GET /api/player — returns the current player's stats for grid centering. */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ rating: null });
	}

	const result = await db
		.select({
			rating: players.rating,
			gamesPlayed: players.gamesPlayed,
			bestWeightedScore: players.bestWeightedScore,
			bestScoreDifficulty: players.bestScoreDifficulty
		})
		.from(players)
		.where(eq(players.userId, locals.user.id))
		.limit(1);

	if (result.length === 0) {
		return json({ rating: null, gamesPlayed: 0, bestWeightedScore: 0, bestScoreDifficulty: 0 });
	}

	return json(result[0]);
};
