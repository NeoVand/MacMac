import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { computeEloChange } from '$lib/game/elo';
import { env } from '$env/dynamic/private';

function isAnonymous(id: string): boolean {
	return id.startsWith('anon-');
}

/**
 * POST /api/battles — receives battle results from PartyKit server.
 * Authenticated via shared secret (PARTYKIT_SECRET).
 *
 * Handles anonymous players gracefully: ELO updates are skipped
 * for any player with an `anon-` prefix ID.
 */
export const POST: RequestHandler = async ({ request }) => {
	const authHeader = request.headers.get('Authorization');
	const secret = env.PARTYKIT_SECRET;

	if (!secret || authHeader !== `Bearer ${secret}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		const body = await request.json();
		const { winnerId, loserId, winnerScore, loserScore } = body;

		if (!winnerId || !loserId) {
			return json({ error: 'Missing player IDs' }, { status: 400 });
		}

		console.log(`Battle result: winner=${winnerId} (score=${winnerScore}), loser=${loserId} (score=${loserScore})`);

		const winnerAnon = isAnonymous(winnerId);
		const loserAnon = isAnonymous(loserId);

		// If both anonymous, compute deltas for display but don't update DB
		if (winnerAnon && loserAnon) {
			const { winnerDelta, loserDelta } = computeEloChange(1200, 1200);
			return json({ success: true, winnerDelta, loserDelta });
		}

		// Fetch real players (skip anonymous)
		const winner = winnerAnon
			? null
			: (await db.select().from(players).where(eq(players.userId, winnerId)).limit(1))[0] ?? null;
		const loser = loserAnon
			? null
			: (await db.select().from(players).where(eq(players.userId, loserId)).limit(1))[0] ?? null;

		// Compute ELO with fallback of 1200 for anonymous/missing
		const winnerElo = winner?.battleElo ?? 1200;
		const loserElo = loser?.battleElo ?? 1200;
		const { winnerDelta, loserDelta } = computeEloChange(winnerElo, loserElo);

		// Update winner (skip if anonymous or missing)
		if (winner) {
			await db
				.update(players)
				.set({
					battleElo: winner.battleElo + winnerDelta,
					battlesPlayed: winner.battlesPlayed + 1,
					battleWins: winner.battleWins + 1,
					updatedAt: new Date()
				})
				.where(eq(players.userId, winnerId));
			console.log(`Updated winner ${winnerId}: ELO ${winner.battleElo} → ${winner.battleElo + winnerDelta}`);
		} else {
			console.log(`Skipped winner update: anon=${winnerAnon}, found=${!!winner}`);
		}

		// Update loser (skip if anonymous or missing)
		if (loser) {
			await db
				.update(players)
				.set({
					battleElo: loser.battleElo + loserDelta,
					battlesPlayed: loser.battlesPlayed + 1,
					updatedAt: new Date()
				})
				.where(eq(players.userId, loserId));
			console.log(`Updated loser ${loserId}: ELO ${loser.battleElo} → ${loser.battleElo + loserDelta}`);
		} else {
			console.log(`Skipped loser update: anon=${loserAnon}, found=${!!loser}`);
		}

		return json({ success: true, winnerDelta, loserDelta });
	} catch (err) {
		console.error('Battle result error:', err);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
