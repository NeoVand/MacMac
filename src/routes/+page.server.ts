import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { resolvePlayerName } from '$lib/utils/player-name';

export const load: PageServerLoad = async ({ locals, request }) => {
	let playerRating: number | null = null;
	let battleElo: number | null = null;
	let country: string | null = null;

	if (locals.user) {
		const result = await db
			.select({ rating: players.rating, battleElo: players.battleElo, country: players.country })
			.from(players)
			.where(eq(players.userId, locals.user.id))
			.limit(1);

		if (result.length > 0) {
			playerRating = result[0].rating;
			battleElo = result[0].battleElo;
			country = result[0].country;

			// Backfill country if missing (for players created before geo-detection)
			if (!country) {
				const detectedCountry = request.headers.get('x-vercel-ip-country')
					|| request.headers.get('cf-ipcountry')
					|| null;
				if (detectedCountry) {
					country = detectedCountry;
					db.update(players)
						.set({ country: detectedCountry })
						.where(eq(players.userId, locals.user.id))
						.then(() => {})
						.catch(() => {});
				}
			}
		} else {
			// Auto-create player row on first authenticated visit
			const playerName = resolvePlayerName(locals.user.name || 'Anonymous');
			country = request.headers.get('x-vercel-ip-country')
				|| request.headers.get('cf-ipcountry')
				|| null;

			try {
				await db.insert(players).values({
					userId: locals.user.id,
					playerName: playerName.slice(0, 24),
					country
				});
			} catch {
				// Unique constraint race — row already created by concurrent request
			}

			playerRating = 3.0;
			battleElo = 1200;
		}
	}

	return { playerRating, battleElo, country };
};
