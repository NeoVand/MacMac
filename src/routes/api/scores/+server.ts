import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { players } from '$lib/server/db/schema';
import { eq, gt, count } from 'drizzle-orm';
import { reconstructLevel } from '$lib/game/generator';
import { computeShapeMatch, computeScore } from '$lib/game/scoring';
import { computeWeightedScore, computeNewRating, computeSkillLevel, getSkillTier } from '$lib/game/rating';
import { resolvePlayerName } from '$lib/utils/player-name';

function resolveCountry(request: Request): string | null {
	return request.headers.get('x-vercel-ip-country')
		|| request.headers.get('cf-ipcountry')
		|| null;
}

// Tier ordering for rank-up detection
const SKILL_TIERS_ORDER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Genius'];

/**
 * Handle generated level submission.
 * Server-side verification: reconstructs the level from seed, recomputes score.
 * Updates the unified players table.
 */
async function handleSubmission(
	request: Request,
	userId: string,
	userName: string,
	body: Record<string, unknown>
) {
	const { seed, targetDifficulty, samples, duration, clicks: clientClicks } = body;

	if (typeof seed !== 'number' || typeof targetDifficulty !== 'number') {
		return json({ success: false, error: 'Missing seed or difficulty' }, { status: 400 });
	}
	if (!Array.isArray(samples) || samples.length < 1) {
		return json({ success: false, error: 'Need at least 1 sample' }, { status: 400 });
	}
	if (samples.some((s: unknown) => typeof s !== 'number' || !isFinite(s as number))) {
		return json({ success: false, error: 'Invalid samples' }, { status: 400 });
	}

	// Reconstruct level server-side (deterministic verification)
	const level = reconstructLevel(seed, targetDifficulty);

	const durationMs = typeof duration === 'number' && duration > 0 && duration < 3600000
		? Math.round(duration) : 300000;
	const totalClicks = typeof clientClicks === 'number' && clientClicks > 0
		? clientClicks : samples.length;

	// Recompute score server-side (anti-cheat)
	const { mse } = computeShapeMatch(samples as number[], level);
	const rawScore = computeScore(mse, durationMs);
	const matchPct = Math.round((1 / (1 + 100 * mse)) * 100);
	const weightedScore = computeWeightedScore(rawScore, level.targetDifficulty);

	const playerName = resolvePlayerName(userName);
	const country = resolveCountry(request);

	// Upsert player record
	const existing = await db
		.select()
		.from(players)
		.where(eq(players.userId, userId))
		.limit(1);

	if (existing.length === 0) {
		// Create new player
		const newRating = computeNewRating(0, weightedScore, 0);
		const newSkillLevel = computeSkillLevel(newRating);
		const newTier = getSkillTier(newSkillLevel);

		await db.insert(players).values({
			userId,
			playerName: playerName.slice(0, 24),
			country,
			rating: newRating,
			gamesPlayed: 1,
			bestWeightedScore: weightedScore,
			bestScoreDifficulty: level.targetDifficulty
		});

		return json({
			success: true,
			weightedScore,
			rawScore,
			difficulty: level.targetDifficulty,
			matchPct,
			isNewBest: true,
			rank: 1,
			skillLevel: newSkillLevel,
			oldSkillLevel: 0,
			tierName: newTier.name,
			tierColor: newTier.color,
			rankUp: newTier.name !== 'Iron'
		});
	}

	const player = existing[0];
	const oldSkillLevel = computeSkillLevel(player.rating);
	const oldTier = getSkillTier(oldSkillLevel);

	const newRating = computeNewRating(player.rating, weightedScore, player.gamesPlayed);
	const newSkillLevel = computeSkillLevel(newRating);
	const newTier = getSkillTier(newSkillLevel);

	const isNewBest = weightedScore > player.bestWeightedScore;

	await db
		.update(players)
		.set({
			playerName: playerName.slice(0, 24),
			country: country || player.country,
			rating: newRating,
			gamesPlayed: player.gamesPlayed + 1,
			bestWeightedScore: isNewBest ? weightedScore : player.bestWeightedScore,
			bestScoreDifficulty: isNewBest ? level.targetDifficulty : player.bestScoreDifficulty,
			updatedAt: new Date()
		})
		.where(eq(players.userId, userId));

	// Compute rank: count of players with higher rating
	const [{ value: betterCount }] = await db
		.select({ value: count() })
		.from(players)
		.where(gt(players.rating, newRating));
	const rank = betterCount + 1;

	return json({
		success: true,
		weightedScore,
		rawScore,
		difficulty: level.targetDifficulty,
		matchPct,
		isNewBest,
		rank,
		skillLevel: newSkillLevel,
		oldSkillLevel,
		tierName: newTier.name,
		tierColor: newTier.color,
		rankUp: newTier.name !== oldTier.name && SKILL_TIERS_ORDER.indexOf(newTier.name) > SKILL_TIERS_ORDER.indexOf(oldTier.name)
	});
}

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.user) {
			return json({ success: false, error: 'Sign in to submit scores' }, { status: 401 });
		}

		const body = await request.json();
		const userId = locals.user.id;
		const userName = locals.user.name || 'Anonymous';

		const levelId = body.levelId;
		if (typeof levelId !== 'string' || !levelId.startsWith('g-')) {
			return json({ success: false, error: 'Invalid level format' }, { status: 400 });
		}

		return handleSubmission(request, userId, userName, body);
	} catch (err) {
		console.error('Score submission error:', err);
		return json({ success: false, error: 'Server error' }, { status: 500 });
	}
};
