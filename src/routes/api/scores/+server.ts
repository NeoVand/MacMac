import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getLevel } from '$lib/game/levels';
import { computeKL, computeScore } from '$lib/game/scoring';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { playerName, playerId, levelId, samples } = body;

		if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
			return json({ success: false, error: 'Name is required' }, { status: 400 });
		}
		if (!playerId || typeof playerId !== 'string') {
			return json({ success: false, error: 'Player ID is required' }, { status: 400 });
		}
		if (!Array.isArray(samples) || samples.length < 3) {
			return json({ success: false, error: 'Need at least 3 samples' }, { status: 400 });
		}
		if (samples.some((s: unknown) => typeof s !== 'number' || !isFinite(s))) {
			return json({ success: false, error: 'Invalid samples' }, { status: 400 });
		}

		const level = getLevel(levelId);
		if (!level) {
			return json({ success: false, error: 'Invalid level' }, { status: 400 });
		}

		// Recompute score server-side to prevent cheating
		const { kl } = computeKL(samples as number[], level);
		const score = computeScore(kl, samples.length, level);

		// Check for existing best score
		const existing = await db
			.select()
			.from(scores)
			.where(and(eq(scores.playerId, playerId), eq(scores.levelId, levelId)))
			.orderBy(desc(scores.score))
			.limit(1);

		const isNewBest = existing.length === 0 || score > existing[0].score;

		if (isNewBest) {
			// Delete old scores for this player+level, insert new best
			if (existing.length > 0) {
				await db
					.delete(scores)
					.where(and(eq(scores.playerId, playerId), eq(scores.levelId, levelId)));
			}

			await db.insert(scores).values({
				playerName: playerName.trim().slice(0, 24),
				playerId,
				levelId,
				score,
				klDivergence: kl,
				clicks: samples.length,
				samples: JSON.stringify(samples)
			});
		}

		return json({
			success: true,
			isNewBest,
			score,
			bestScore: isNewBest ? score : existing[0].score
		});
	} catch (err) {
		console.error('Score submission error:', err);
		return json({ success: false, error: 'Server error' }, { status: 500 });
	}
};
