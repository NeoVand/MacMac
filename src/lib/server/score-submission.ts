import { eq } from 'drizzle-orm';
import type { db } from './db';
import { scoreSubmissions } from './db/schema';

export type ScoreDatabase = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;

/** Commit the rating change and its receipt together, or neither. */
export async function saveScoreOnce(
	database: typeof db,
	userId: string,
	submissionId: string | undefined,
	save: (transaction: ScoreDatabase) => Promise<Response>
): Promise<Response> {
	return database.transaction(async (transaction) => {
		if (submissionId) {
			const [receipt] = await transaction
				.select()
				.from(scoreSubmissions)
				.where(eq(scoreSubmissions.id, submissionId))
				.limit(1);
			if (receipt) {
				if (receipt.userId !== userId) {
					return Response.json(
						{ success: false, error: 'This game was already saved to another account' },
						{ status: 409 }
					);
				}
				return new Response(receipt.response, {
					headers: { 'Content-Type': 'application/json' }
				});
			}
		}

		const response = await save(transaction);
		if (submissionId && response.ok) {
			await transaction.insert(scoreSubmissions).values({
				id: submissionId,
				userId,
				response: await response.clone().text()
			});
		}
		return response;
	});
}
