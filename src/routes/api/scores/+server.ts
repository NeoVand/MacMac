import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { getLevel } from '$lib/game/levels';
import { computeShapeMatch, computeScore } from '$lib/game/scoring';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		if (!locals.user) {
			return json({ success: false, error: 'Sign in to submit scores' }, { status: 401 });
		}

		const body = await request.json();
		const { levelId, samples, duration, clicks: clientClicks } = body;

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

		const playerId = locals.user.id;
		const fullName = locals.user.name || 'Anonymous';
		const nameParts = fullName.trim().split(/\s+/);
		const playerName = nameParts.length > 1
			? `${nameParts[0]} ${nameParts[nameParts.length - 1][0]}.`
			: nameParts[0];
		const totalClicks = typeof clientClicks === 'number' && clientClicks > 0 ? clientClicks : samples.length;
		const durationMs = typeof duration === 'number' && duration > 0 && duration < 3600000 ? Math.round(duration) : null;

		const country = request.headers.get('x-vercel-ip-country')
			|| request.headers.get('cf-ipcountry')
			|| null;

		const { mse } = computeShapeMatch(samples as number[], level);
		const score = computeScore(mse, durationMs ?? 300000);

		const existing = await db
			.select()
			.from(scores)
			.where(and(eq(scores.playerId, playerId), eq(scores.levelId, levelId)))
			.orderBy(desc(scores.score))
			.limit(1);

		const isNewBest = existing.length === 0 || score > existing[0].score;

		if (isNewBest) {
			if (existing.length > 0) {
				await db.delete(scores).where(and(eq(scores.playerId, playerId), eq(scores.levelId, levelId)));
			}

			await db.insert(scores).values({
				playerName: playerName.slice(0, 24),
				playerId,
				levelId,
				score,
				klDivergence: mse,
				clicks: totalClicks,
				duration: durationMs,
				country,
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
