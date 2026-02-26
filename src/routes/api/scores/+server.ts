import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scores, players } from '$lib/server/db/schema';
import { and, eq, desc, gt, count } from 'drizzle-orm';
import { getLevel } from '$lib/game/levels';
import { reconstructLevel, parseGeneratedId } from '$lib/game/generator';
import { computeShapeMatch, computeScore } from '$lib/game/scoring';
import { computeWeightedScore, computeNewRating } from '$lib/game/rating';
import { resolvePlayerName } from '$lib/utils/player-name';

function resolveCountry(request: Request): string | null {
	return request.headers.get('x-vercel-ip-country')
		|| request.headers.get('cf-ipcountry')
		|| null;
}

/**
 * Handle generated level submission.
 * Server-side verification: reconstructs the level from seed, recomputes score.
 * Updates the unified players table.
 */
async function handleGeneratedSubmission(
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
		const newRating = computeNewRating(3.0, level.targetDifficulty, matchPct, 0);
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
			rank: 1
		});
	}

	const player = existing[0];
	const newRating = computeNewRating(player.rating, level.targetDifficulty, matchPct, player.gamesPlayed);
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

	// Compute rank: count of players with better best score
	const [{ value: betterCount }] = await db
		.select({ value: count() })
		.from(players)
		.where(gt(players.bestWeightedScore, isNewBest ? weightedScore : player.bestWeightedScore));
	const rank = betterCount + 1;

	return json({
		success: true,
		weightedScore,
		rawScore,
		difficulty: level.targetDifficulty,
		matchPct,
		isNewBest,
		rank
	});
}

/**
 * Handle legacy level submission.
 * Writes to the old scores table (kept for backward compatibility).
 */
async function handleLegacySubmission(
	request: Request,
	userId: string,
	userName: string,
	body: Record<string, unknown>
) {
	const { levelId, samples, duration, clicks: clientClicks } = body;

	if (!Array.isArray(samples) || samples.length < 1) {
		return json({ success: false, error: 'Need at least 1 sample' }, { status: 400 });
	}
	if (samples.some((s: unknown) => typeof s !== 'number' || !isFinite(s as number))) {
		return json({ success: false, error: 'Invalid samples' }, { status: 400 });
	}

	const level = getLevel(levelId as number);
	if (!level) {
		return json({ success: false, error: 'Invalid level' }, { status: 400 });
	}

	const playerName = resolvePlayerName(userName);
	const totalClicks = typeof clientClicks === 'number' && clientClicks > 0 ? clientClicks : samples.length;
	const durationMs = typeof duration === 'number' && duration > 0 && duration < 3600000
		? Math.round(duration) : null;
	const country = resolveCountry(request);

	const { mse } = computeShapeMatch(samples as number[], level);
	const score = computeScore(mse, durationMs ?? 300000);

	const existing = await db
		.select()
		.from(scores)
		.where(and(eq(scores.playerId, userId), eq(scores.levelId, levelId as number)))
		.orderBy(desc(scores.score))
		.limit(1);

	const isNewBest = existing.length === 0 || score > existing[0].score;

	if (isNewBest) {
		if (existing.length > 0) {
			await db.delete(scores).where(and(eq(scores.playerId, userId), eq(scores.levelId, levelId as number)));
		}

		await db.insert(scores).values({
			playerName: playerName.slice(0, 24),
			playerId: userId,
			levelId: levelId as number,
			score,
			klDivergence: mse,
			clicks: totalClicks,
			duration: durationMs,
			country,
			samples: JSON.stringify(samples)
		});
	}

	const scoreForRank = isNewBest ? score : existing[0].score;
	const [{ value: betterCount }] = await db
		.select({ value: count() })
		.from(scores)
		.where(and(eq(scores.levelId, levelId as number), gt(scores.score, scoreForRank)));
	const rank = betterCount + 1;

	return json({
		success: true,
		isNewBest,
		score,
		bestScore: isNewBest ? score : existing[0].score,
		rank
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

		// Route to the correct handler based on levelId format
		const levelId = body.levelId;
		if (typeof levelId === 'string' && levelId.startsWith('g-')) {
			return handleGeneratedSubmission(request, userId, userName, body);
		}

		return handleLegacySubmission(request, userId, userName, body);
	} catch (err) {
		console.error('Score submission error:', err);
		return json({ success: false, error: 'Server error' }, { status: 500 });
	}
};
