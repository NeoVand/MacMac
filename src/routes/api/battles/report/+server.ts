import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { verifyBattleResult } from '$lib/server/battle-crypto';

/**
 * POST /api/battles/report — client-side battle result reporting.
 * Authenticated via session cookie + HMAC-signed result token from PartyKit.
 *
 * The PartyKit battle server signs a token containing the battle result
 * (battleId, playerId, won, eloDelta, timestamp) using the shared secret.
 * The client forwards this token here. We verify the signature before
 * applying any ELO update.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const secret = env.PARTYKIT_SECRET;
	if (!secret) {
		return json({ error: 'Server misconfigured' }, { status: 500 });
	}

	try {
		const { resultToken } = await request.json();

		if (typeof resultToken !== 'string' || !resultToken) {
			return json({ error: 'Missing result token' }, { status: 400 });
		}

		// Verify HMAC signature and decode payload
		const payload = await verifyBattleResult(resultToken, secret);
		if (!payload) {
			return json({ error: 'Invalid or expired token' }, { status: 403 });
		}

		// Ensure the token's playerId matches the authenticated user
		if (payload.playerId !== locals.user.id) {
			return json({ error: 'Token player mismatch' }, { status: 403 });
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
				battleElo: player.battleElo + payload.eloDelta,
				battlesPlayed: player.battlesPlayed + 1,
				battleWins: payload.won ? player.battleWins + 1 : player.battleWins,
				updatedAt: new Date()
			})
			.where(eq(players.userId, userId));

		return json({ success: true, newElo: player.battleElo + payload.eloDelta });
	} catch (err) {
		console.error('Battle report error:', err);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
