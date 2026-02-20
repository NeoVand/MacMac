import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { and, eq, gt, count } from 'drizzle-orm';
import { getLevel } from '$lib/game/levels';

export const GET: RequestHandler = async ({ url }) => {
	const levelId = Number(url.searchParams.get('levelId'));
	const score = Number(url.searchParams.get('score'));

	if (!Number.isInteger(levelId) || levelId < 1 || !Number.isFinite(score) || score < 0) {
		return json({ error: 'Invalid levelId or score' }, { status: 400 });
	}

	const level = getLevel(levelId);
	if (!level) {
		return json({ error: 'Level not found' }, { status: 400 });
	}

	const [{ value: betterCount }] = await db
		.select({ value: count() })
		.from(scores)
		.where(and(eq(scores.levelId, levelId), gt(scores.score, score)));
	const rank = betterCount + 1;

	return json({ rank });
};
