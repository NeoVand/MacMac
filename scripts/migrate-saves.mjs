import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = createClient({
	url: process.env.DATABASE_URL,
	authToken: process.env.DATABASE_AUTH_TOKEN
});
try {
	for (const file of ['0001_score_submissions.sql', '0002_battle_claims.sql']) {
		const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
		await client.executeMultiple(sql);
	}
	console.log(
		'Solo and battle save receipts are ready. Existing scores and players are unchanged.'
	);
} finally {
	client.close();
}
