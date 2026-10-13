import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players, battleClaims } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { isGuestPlayerId, verifyBattleResult } from '$lib/server/battle-crypto';
import { getBattleTier, BATTLE_TIERS } from '$lib/game/elo';
import { resolvePlayerName } from '$lib/utils/player-name';

const BATTLE_TIERS_ORDER = BATTLE_TIERS.map((t) => t.name);

/**
 * POST /api/battles/report — client-side battle result reporting.
 * Authenticated via session cookie + HMAC-signed result token from PartyServer.
 *
 * The battle server signs a token containing the battle result
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
		let body: { resultToken?: unknown };
		try {
			body = await request.json();
		} catch {
			return json({ error: 'Invalid JSON' }, { status: 400 });
		}
		const resultToken = body?.resultToken;

		if (typeof resultToken !== 'string' || !resultToken || resultToken.length > 5000) {
			return json({ error: 'Missing result token' }, { status: 400 });
		}

		// Verify HMAC signature and decode payload
		const payload = await verifyBattleResult(resultToken, secret);
		if (!payload) {
			return json({ error: 'Invalid or expired token' }, { status: 403 });
		}

		// A signed guest result is a bearer proof held by the guest before OAuth.
		// Named-user results can only be saved by that same authenticated user.
		if (payload.playerId !== locals.user.id && !isGuestPlayerId(payload.playerId)) {
			return json({ error: 'Token player mismatch' }, { status: 403 });
		}

		const userId = locals.user.id;

		return await db.transaction(async (transaction) => {
			const claimId = `${payload.battleId}:${payload.playerId}`;
			const [receipt] = await transaction
				.select()
				.from(battleClaims)
				.where(eq(battleClaims.id, claimId))
				.limit(1);
			if (receipt) {
				if (receipt.userId !== userId) {
					return json(
						{ error: 'This battle was already saved to another account' },
						{ status: 409 }
					);
				}
				return new Response(receipt.response, { headers: { 'Content-Type': 'application/json' } });
			}
			const [otherParticipant] = await transaction
				.select()
				.from(battleClaims)
				.where(and(eq(battleClaims.userId, userId), eq(battleClaims.battleId, payload.battleId)))
				.limit(1);
			if (otherParticipant) {
				return json({ error: 'You already saved a result from this battle' }, { status: 409 });
			}

			// OAuth can return directly to a battle before the homepage creates a profile.
			await transaction
				.insert(players)
				.values({
					userId,
					playerName: resolvePlayerName(locals.user!.name || 'Anonymous').slice(0, 24),
					country:
						request.headers.get('x-vercel-ip-country') ||
						request.headers.get('cf-ipcountry') ||
						null
				})
				.onConflictDoNothing({ target: players.userId });
			const [player] = await transaction
				.select()
				.from(players)
				.where(eq(players.userId, userId))
				.limit(1);
			const oldElo = player.battleElo;
			const newElo = oldElo + payload.eloDelta;
			const oldTier = getBattleTier(oldElo);
			const newTier = getBattleTier(newElo);
			const rankUp =
				BATTLE_TIERS_ORDER.indexOf(newTier.name) > BATTLE_TIERS_ORDER.indexOf(oldTier.name);
			await transaction
				.update(players)
				.set({
					battleElo: newElo,
					battlesPlayed: player.battlesPlayed + 1,
					battleWins: payload.won ? player.battleWins + 1 : player.battleWins,
					updatedAt: new Date()
				})
				.where(eq(players.userId, userId));
			const result = {
				success: true,
				newElo,
				tierName: newTier.name,
				tierColor: newTier.color,
				oldTierName: oldTier.name,
				rankUp
			};
			await transaction.insert(battleClaims).values({
				id: claimId,
				battleId: payload.battleId,
				userId,
				response: JSON.stringify(result)
			});
			return json(result);
		});
	} catch (err) {
		console.error('Battle report error:', err);
		return json({ error: 'Server error' }, { status: 500 });
	}
};
