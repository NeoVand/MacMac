import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { createServer } from 'vite';
import { signBattleResult } from '../party/src/shared/crypto.ts';

let directory;
let client;
let vite;
let POST;
let db;
let saveScoreOnce;
let players;
let auth;
let reportBattle;
const battleSecret = 'isolated-battle-test-secret';
const user = { id: 'test-player', name: 'Test Player' };

before(async () => {
	directory = await mkdtemp(join(tmpdir(), 'macmac-scores-'));
	// Explicitly override the real database before any application module loads.
	process.env.DATABASE_URL = `file:${join(directory, 'test.db')}`;
	process.env.DATABASE_AUTH_TOKEN = '';
	process.env.BETTER_AUTH_URL = 'http://localhost:5173';
	process.env.BETTER_AUTH_SECRET = 'isolated-auth-test-secret-at-least-32-characters';
	process.env.GITHUB_CLIENT_ID = 'local-test-client';
	process.env.GITHUB_CLIENT_SECRET = 'local-test-secret';
	process.env.GOOGLE_CLIENT_ID = 'local-test-client';
	process.env.GOOGLE_CLIENT_SECRET = 'local-test-secret';
	process.env.PARTYKIT_SECRET = battleSecret;
	client = createClient({ url: process.env.DATABASE_URL });
	await client.executeMultiple(`
		CREATE TABLE players (
			id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, player_name TEXT NOT NULL,
			country TEXT, rating REAL NOT NULL DEFAULT 0, games_played INTEGER NOT NULL DEFAULT 0,
			best_weighted_score INTEGER NOT NULL DEFAULT 0, best_score_difficulty REAL NOT NULL DEFAULT 0,
			battle_elo INTEGER NOT NULL DEFAULT 1200, battles_played INTEGER NOT NULL DEFAULT 0,
			battle_wins INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
		);
		CREATE TABLE scores (
			id TEXT PRIMARY KEY, player_name TEXT NOT NULL, player_id TEXT NOT NULL,
			level_id INTEGER NOT NULL, score INTEGER NOT NULL, kl_divergence REAL NOT NULL,
			clicks INTEGER NOT NULL, duration INTEGER, country TEXT, samples TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE user (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
			email_verified INTEGER NOT NULL DEFAULT 0, image TEXT,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		);
		CREATE TABLE account (
			id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES user(id), access_token TEXT, refresh_token TEXT,
			id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER,
			scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		);
		CREATE TABLE session (
			id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL REFERENCES user(id)
		);
		CREATE TABLE verification (
			id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
			expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
		);
	`);
	const migration = await readFile(
		new URL('../migrations/0001_score_submissions.sql', import.meta.url),
		'utf8'
	);
	await client.execute(migration);
	await client.execute(migration); // Deploy-time migration is safe to rerun.
	await client.executeMultiple(
		await readFile(new URL('../migrations/0002_battle_claims.sql', import.meta.url), 'utf8')
	);
	vite = await createServer({
		server: { middlewareMode: true, hmr: false, ws: false },
		appType: 'custom'
	});
	({ POST } = await vite.ssrLoadModule('/src/routes/api/scores/+server.ts'));
	({ db } = await vite.ssrLoadModule('/src/lib/server/db/index.ts'));
	({ saveScoreOnce } = await vite.ssrLoadModule('/src/lib/server/score-submission.ts'));
	({ players } = await vite.ssrLoadModule('/src/lib/server/db/schema.ts'));
	({ auth } = await vite.ssrLoadModule('/src/lib/server/auth.ts'));
	({ POST: reportBattle } = await vite.ssrLoadModule('/src/routes/api/battles/report/+server.ts'));
});

after(async () => {
	await vite?.close();
	client?.close();
	if (directory) await rm(directory, { recursive: true, force: true });
});

const generated = {
	levelId: 'g-3f-40',
	seed: 123,
	targetDifficulty: 4,
	samples: [-1, 0, 1],
	duration: 12345,
	clicks: 3
};

async function submit(body, authenticatedUser = user) {
	return POST({
		request: new Request('http://localhost/api/scores', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { user: authenticatedUser }
	});
}

test('guest cannot submit before signing in', async () => {
	assert.equal((await submit(generated, null)).status, 401);
});

test('a restored generated game is saved once across repeated retries', async () => {
	const body = { ...generated, submissionId: crypto.randomUUID() };
	const first = await submit(body);
	assert.equal(first.status, 200);
	const result = await first.json();
	assert.equal(result.success, true);
	assert.equal(result.difficulty, 4);
	for (let i = 0; i < 3; i++) {
		assert.deepEqual(await (await submit(body)).json(), result);
	}
	const row = (
		await client.execute({
			sql: 'SELECT games_played FROM players WHERE user_id = ?',
			args: [user.id]
		})
	).rows[0];
	assert.equal(row.games_played, 1);
});

test('a second attempt gets a separate save', async () => {
	assert.equal((await submit({ ...generated, submissionId: crypto.randomUUID() })).status, 200);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT games_played FROM players WHERE user_id = ?',
				args: [user.id]
			})
		).rows[0].games_played,
		2
	);
});

test('receipts cannot be claimed by another account', async () => {
	const body = { ...generated, submissionId: crypto.randomUUID() };
	assert.equal((await submit(body)).status, 200);
	assert.equal(
		(await submit(body, { id: 'different-player', name: 'Different Player' })).status,
		409
	);
});

test('removed legacy levels remain unsupported', async () => {
	const body = {
		levelId: 1,
		samples: [-1, 0, 1],
		duration: 10000,
		clicks: 3,
		submissionId: crypto.randomUUID()
	};
	assert.equal((await submit(body)).status, 400);
	assert.equal((await client.execute('SELECT COUNT(*) AS n FROM scores')).rows[0].n, 0);
});

test('invalid restored payloads do not create receipts or change ratings', async () => {
	const before = (
		await client.execute({
			sql: 'SELECT games_played FROM players WHERE user_id = ?',
			args: [user.id]
		})
	).rows[0].games_played;
	for (const body of [
		{ ...generated, seed: 124 },
		{ ...generated, targetDifficulty: null },
		{ ...generated, samples: [] },
		{ ...generated, samples: [null] },
		{ ...generated, submissionId: 'bad-id' },
		null
	]) {
		assert.equal((await submit(body)).status, 400);
	}
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT games_played FROM players WHERE user_id = ?',
				args: [user.id]
			})
		).rows[0].games_played,
		before
	);
});

test('receipt and rating are rolled back together when saving fails', async () => {
	const submissionId = crypto.randomUUID();
	await assert.rejects(
		saveScoreOnce(db, user.id, submissionId, async (transaction) => {
			await transaction.update(players).set({ gamesPlayed: 999 });
			throw new Error('Simulated database failure');
		}),
		/Simulated database failure/
	);
	assert.notEqual(
		(
			await client.execute({
				sql: 'SELECT games_played FROM players WHERE user_id = ?',
				args: [user.id]
			})
		).rows[0].games_played,
		999
	);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT COUNT(*) AS n FROM score_submissions WHERE id = ?',
				args: [submissionId]
			})
		).rows[0].n,
		0
	);
});

test('updated authentication creates and reads a session with the existing core schema', async () => {
	const response = await auth.handler(
		new Request('http://localhost:5173/api/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
			body: JSON.stringify({
				email: 'local-test@example.invalid',
				password: 'local-test-password-12345',
				name: 'Local Auth Test'
			})
		})
	);
	assert.equal(response.status, 200);
	const cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
	assert.ok(cookie);
	const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
	assert.equal(session.user.email, 'local-test@example.invalid');
});

for (const provider of ['github', 'google']) {
	test(`updated ${provider} sign-in keeps the game callback URL`, async () => {
		const callbackURL = 'http://localhost:5173/play/g-3f-40';
		const response = await auth.handler(
			new Request('http://localhost:5173/api/auth/sign-in/social', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
				body: JSON.stringify({
					provider,
					callbackURL,
					errorCallbackURL: callbackURL,
					disableRedirect: true
				})
			})
		);
		assert.equal(response.status, 200);
		const body = await response.json();
		const url = new URL(body.url);
		assert.equal(
			url.searchParams.get('redirect_uri'),
			`http://localhost:5173/api/auth/callback/${provider}`
		);
		assert.ok(url.searchParams.get('state'));
	});
}

async function claimBattle(
	payload,
	authenticatedUser = { id: 'new-battle-player', name: 'New Battle Player' },
	secret = battleSecret
) {
	const resultToken = await signBattleResult(payload, secret);
	return reportBattle({
		request: new Request('http://localhost/api/battles/report', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ resultToken })
		}),
		locals: { user: authenticatedUser }
	});
}

const guestResult = () => ({
	battleId: `${Date.now()}-5`,
	playerId: `anon-${crypto.randomUUID()}`,
	won: true,
	eloDelta: 16,
	ts: Date.now()
});

test('a guest battle survives OAuth delay and is claimed once by a new account', async () => {
	const payload = { ...guestResult(), ts: Date.now() - 8 * 60 * 60 * 1000 };
	const response = await claimBattle(payload);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.newElo, 1216);
	assert.deepEqual(await (await claimBattle(payload)).json(), result);
	const row = (
		await client.execute({
			sql: 'SELECT battles_played, battle_wins FROM players WHERE user_id = ?',
			args: ['new-battle-player']
		})
	).rows[0];
	assert.equal(row.battles_played, 1);
	assert.equal(row.battle_wins, 1);
	assert.equal(
		(await claimBattle(payload, { id: 'another-account', name: 'Another Account' })).status,
		409
	);
	const otherParticipant = {
		...payload,
		playerId: `anon-${crypto.randomUUID()}`,
		won: false,
		eloDelta: -16
	};
	assert.equal((await claimBattle(otherParticipant)).status, 409);
});

test('named-player battle reports remain bound to their own account and are idempotent', async () => {
	const payload = { ...guestResult(), playerId: user.id };
	assert.equal((await claimBattle(payload)).status, 403);
	const response = await claimBattle(payload, user);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.deepEqual(await (await claimBattle(payload, user)).json(), result);
	assert.equal(
		(
			await client.execute({
				sql: 'SELECT battles_played FROM players WHERE user_id = ?',
				args: [user.id]
			})
		).rows[0].battles_played,
		1
	);
});

test('battle claims reject forged, expired, future and malformed signed tokens', async () => {
	assert.equal((await claimBattle(guestResult(), null)).status, 401);
	assert.equal((await claimBattle(guestResult(), undefined, 'wrong-secret')).status, 403);
	for (const payload of [
		{ ...guestResult(), ts: Date.now() - 25 * 60 * 60 * 1000 },
		{ ...guestResult(), playerId: user.id, ts: Date.now() - 10 * 60 * 1000 },
		{ ...guestResult(), ts: Date.now() + 120000 },
		{ ...guestResult(), eloDelta: null },
		{ ...guestResult(), won: 'yes' }
	]) {
		assert.equal((await claimBattle(payload, user)).status, 403);
	}
});
