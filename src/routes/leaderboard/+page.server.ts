import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { scores } from '$lib/server/db/schema';
import { desc, eq } from 'drizzle-orm';
import { levels } from '$lib/game/levels';

export const load: PageServerLoad = async () => {
	const leaderboardData: Record<
		number,
		{ playerName: string; score: number; clicks: number; kl: number; duration: number | null; createdAt: Date }[]
	> = {};

	for (const level of levels) {
		const rows = await db
			.select({
				playerName: scores.playerName,
				score: scores.score,
				clicks: scores.clicks,
				kl: scores.klDivergence,
				duration: scores.duration,
				createdAt: scores.createdAt
			})
			.from(scores)
			.where(eq(scores.levelId, level.id))
			.orderBy(desc(scores.score))
			.limit(20);

		leaderboardData[level.id] = rows;
	}

	return { leaderboardData };
};
