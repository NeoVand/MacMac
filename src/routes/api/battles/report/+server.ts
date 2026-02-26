import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

/**
 * POST /api/battles/report — client-side battle result reporting.
 * Authenticated via session cookie (better-auth).
 *
 * Each player reports their own result after the battle ends.
 * The battle server (PartyKit) is authoritative — the client
 * forwards the eloDelta it received from the server.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	try {
		const { won, eloDelta } = await request.json();

		if (typeof won !== 'boolean' || typeof eloDelta !== 'number') {
			return json({ error: 'Invalid payload' }, { status: 400 });
		}

		const userId = locals.user.id;

		const rows = await db
			.select()
			.from(players)
			.where(eq(players.userId, userId))
			.limit(1);

		if (rows.length === 0) {
			return json({ error: 'Player not found' }, { status: 404 });
		}

		const player = rows[0];

		await db
			.update(players)
			.set({
				battleElo: player.battleElo + eloDelta,
				battlesPlayed: player.battlesPlayed + 1,
				battleWins: won ? player.battleWins + 1 : player.battleWins,
				updatedAt: new Date()
			})
			.where(eq(players.userId, userId));

		return json({ success: true, newElo: player.battleElo + eloDelta });
	} catch (err) {
		console.error('Battle report error:', err);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
