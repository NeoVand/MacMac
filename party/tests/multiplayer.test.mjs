import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyBattleResult } from '../src/shared/crypto.ts';

let worker;
let directory;
let host;
let httpProtocol = 'http';
let websocketProtocol = 'ws';
const remoteHost = process.env.BATTLE_SMOKE_HOST;
const queueRoom = remoteHost ? `smoke-${crypto.randomUUID()}` : 'global';
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.resolve('wrangler'))(
	'miniflare'
);
const sockets = [];
const secret = remoteHost ? process.env.PARTYKIT_SECRET : 'local-test-secret';

before(
	async () => {
		if (remoteHost) {
			if (!secret) throw new Error('PARTYKIT_SECRET is required for a deployed-service check');
			host = new URL(remoteHost).host;
			httpProtocol = 'https';
			websocketProtocol = 'wss';
			return;
		}
		directory = await mkdtemp(join(tmpdir(), 'macmac-worker-'));
		worker = new Miniflare(
			convertV4MiniflareOptions({
				scriptPath: fileURLToPath(new URL('../dist/index.js', import.meta.url)),
				modules: true,
				compatibilityDate: '2026-10-12',
				compatibilityFlags: ['nodejs_compat'],
				durableObjects: {
					Main: { className: 'BattleServer', useSQLite: true },
					Matchmaker: { className: 'Matchmaker', useSQLite: true }
				},
				durableObjectsPersist: directory,
				bindings: { PARTYKIT_SECRET: secret }
			})
		);
		host = (await worker.ready).host;
	},
	{ timeout: 35000 }
);

after(async () => {
	const closing = sockets.map(
		(socket) =>
			new Promise((resolve) => {
				if (socket.readyState === WebSocket.CLOSED) return resolve();
				socket.addEventListener('close', resolve, { once: true });
				socket.close(1000, 'Test completed');
			})
	);
	await worker?.dispose();
	await Promise.race([
		Promise.all(closing),
		delay(5000).then(() => {
			throw new Error('Test sockets did not close');
		})
	]);
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function connect(party, room) {
	const socket = new WebSocket(`${websocketProtocol}://${host}/parties/${party}/${room}`);
	sockets.push(socket);
	const messages = [];
	socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	return {
		send: (message) => socket.send(JSON.stringify(message)),
		async receive(type, timeout = 40000) {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				const index = messages.findIndex((message) => message.type === type);
				if (index >= 0) return messages.splice(index, 1)[0];
				await delay(20);
			}
			throw new Error(
				`Timed out waiting for ${type}. Received types: ${messages.map((message) => message.type).join(', ')}.`
			);
		}
	};
}

test('health and unknown routes', async () => {
	assert.deepEqual(await (await fetch(`${httpProtocol}://${host}/health`)).json(), {
		ok: true,
		service: 'macmac-battle'
	});
	assert.equal((await fetch(`${httpProtocol}://${host}/missing`)).status, 404);
});

test(
	'two players match, play, exchange KDE updates and get valid signed results',
	{ timeout: 45000 },
	async () => {
		const a = await connect('matchmaker', queueRoom);
		const b = await connect('matchmaker', queueRoom);
		a.send({ type: 'join_queue', playerId: 'player-a', playerName: 'Alice', battleElo: 1200 });
		assert.equal((await a.receive('queue_status')).waitingCount, 1);
		const queued = await fetch(`${httpProtocol}://${host}/parties/matchmaker/${queueRoom}`);
		assert.deepEqual(await queued.json(), { searching: 1 });
		assert.equal(queued.headers.get('access-control-allow-origin'), '*');
		assert.equal(queued.headers.get('cache-control'), 'no-store');
		b.send({ type: 'join_queue', playerId: 'player-b', playerName: 'Bob', battleElo: 1200 });
		const [matchA, matchB] = await Promise.all([
			a.receive('match_found'),
			b.receive('match_found')
		]);
		assert.equal(matchA.battleId, matchB.battleId);
		assert.equal(matchA.opponentName, 'Bob');
		assert.equal(matchB.opponentName, 'Alice');
		const battleA = await connect('main', matchA.battleId);
		const battleB = await connect('main', matchB.battleId);
		battleA.send({ type: 'join', playerId: 'player-a', playerName: 'Alice', battleElo: 1200 });
		battleB.send({ type: 'join', playerId: 'player-b', playerName: 'Bob', battleElo: 1200 });
		const [startA, startB] = await Promise.all([
			battleA.receive('start'),
			battleB.receive('start')
		]);
		assert.equal(startA.seed, matchA.seed);
		assert.equal(startB.targetDifficulty, matchB.targetDifficulty);
		assert.equal(startA.durationMs, 30000);
		for (const x of [-1, 0, 1]) {
			battleA.send({ type: 'add_sample', x });
			battleB.send({ type: 'add_sample', x: x + 0.5 });
			await delay(80);
		}
		assert.equal((await battleA.receive('opponent_kde')).kde.length, 200);
		const [endA, endB] = await Promise.all([
			battleA.receive('battle_end'),
			battleB.receive('battle_end')
		]);
		assert.equal(endA.winnerId, endB.winnerId);
		assert.notEqual(endA.won, endB.won);
		assert.equal(endA.yourScore, endB.opponentScore);
		assert.equal(endB.yourScore, endA.opponentScore);
		assert.ok(Array.isArray(endA.opponentSamples));
		assert.equal(endA.yourEloDelta + endB.yourEloDelta, 0);
		const tokenA = await verifyBattleResult(endA.resultToken, secret);
		const tokenB = await verifyBattleResult(endB.resultToken, secret);
		assert.equal(tokenA.playerId, 'player-a');
		assert.equal(tokenB.playerId, 'player-b');
		assert.equal(tokenA.battleId, matchA.battleId);
		assert.notEqual(tokenA.won, tokenB.won);
		assert.equal(await verifyBattleResult(endA.resultToken, 'incorrect-secret'), null);
	}
);
