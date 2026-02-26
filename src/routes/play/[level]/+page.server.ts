import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
	const levelParam = params.level;

	// Generated levels (g-{seed}-{diff}) don't have per-level leaderboards
	if (levelParam.startsWith('g-')) {
		return {
			isGenerated: true as const,
			topScores: [] as number[],
			topScore: 0,
			topPlayer: null as string | null
		};
	}

	// Legacy levels (1-8): fetch from old scores table
	const levelId = Number(levelParam);
	const topScores = await db
		.select({ score: scores.score, playerName: scores.playerName })
		.from(scores)
		.where(eq(scores.levelId, levelId))
		.orderBy(desc(scores.score))
		.limit(3);

	return {
		isGenerated: false as const,
		topScores: topScores.map((row) => row.score),
		topScore: topScores.length > 0 ? topScores[0].score : 0,
		topPlayer: topScores.length > 0 ? topScores[0].playerName : null
	};
};
