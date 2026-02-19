import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
	const levelId = Number(params.level);

	const topScores = await db
		.select({ score: scores.score, playerName: scores.playerName })
		.from(scores)
		.where(eq(scores.levelId, levelId))
		.orderBy(desc(scores.score))
		.limit(1);

	return {
		topScore: topScores.length > 0 ? topScores[0].score : 0,
		topPlayer: topScores.length > 0 ? topScores[0].playerName : null
	};
};
