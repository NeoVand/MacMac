import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, locals }) => {
	const levelParam = params.level;

	// Only generated levels (g-{seed}-{diff}) are supported
	if (!levelParam.startsWith('g-')) {
		redirect(302, '/');
	}

	// Load player rating for skill preview (authenticated users only)
	let playerRating: number | null = null;
	let playerGamesPlayed = 0;

	if (locals.user) {
		const result = await db
			.select({ rating: players.rating, gamesPlayed: players.gamesPlayed })
			.from(players)
			.where(eq(players.userId, locals.user.id))
			.limit(1);
		if (result.length > 0) {
			playerRating = result[0].rating;
			playerGamesPlayed = result[0].gamesPlayed;
		}
	}

	return {
		playerRating,
		playerGamesPlayed
	};
};
