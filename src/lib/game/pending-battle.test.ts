import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clearPendingBattle,
	pendingBattleKey,
	readPendingBattle,
	writePendingBattle,
	type PendingBattle
} from './pending-battle.ts';
import type { GameStorage } from './pending-game.ts';

function memoryStorage(): GameStorage {
	const values = new Map<string, string>();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		}
	};
}

function battle(): PendingBattle {
	return {
		version: 1,
		battleId: '12345-4',
		playerId: 'anon-c587bd2f-6911-4520-9942-3659191c306b',
		seed: 12345,
		targetDifficulty: 4,
		durationMs: 20000,
		result: {
			type: 'battle_end',
			won: true,
			winnerId: 'anon-c587bd2f-6911-4520-9942-3659191c306b',
			winnerName: 'Anonymous',
			yourScore: 9000,
			yourMatchPct: 95,
			opponentScore: 7000,
			opponentMatchPct: 72,
			yourEloDelta: 24,
			resultToken: 'signed.result-token',
			opponentSamples: [-1, 0, 0.5]
		},
		samples: [-1.2, 0.1, 1],
		opponentName: 'Opponent',
		opponentElo: 1210,
		opponentCountry: 'US',
		isJackpot: true,
		jackpotMatchPct: 95,
		showYou: false,
		showOpponent: true,
		pendingReport: true,
		requestSent: false
	};
}

test('completed anonymous battle preserves signed result, identities, replays, and toggles across repeated restores', () => {
	const storage = memoryStorage();
	const state = battle();
	assert.equal(writePendingBattle(state, storage), true);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
	assert.equal(
		readPendingBattle(state.battleId, storage)?.result.resultToken,
		state.result.resultToken
	);
});

test('failed battle report preserves the original token for a safe manual retry', () => {
	const storage = memoryStorage();
	const state = battle();
	writePendingBattle(state, storage);
	const failed = { ...state, pendingReport: false, requestSent: true };
	assert.equal(writePendingBattle(failed, storage), true);
	assert.deepEqual(readPendingBattle(state.battleId, storage), failed);
});

test('confirmation clears only the matching signed result', () => {
	const storage = memoryStorage();
	const state = battle();
	writePendingBattle(state, storage);
	assert.equal(clearPendingBattle(state.battleId, 'other.signed-token', storage), false);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
	assert.equal(clearPendingBattle(state.battleId, state.result.resultToken!, storage), true);
	assert.equal(readPendingBattle(state.battleId, storage), null);
});

test('independent battle snapshots remain recoverable when another result is confirmed', () => {
	const storage = memoryStorage();
	const first = battle();
	const second = { ...battle(), battleId: '54321-5.5', seed: 54321, targetDifficulty: 5.5 };
	writePendingBattle(first, storage);
	writePendingBattle(second, storage);
	assert.equal(readPendingBattle('other-room', storage), null);
	clearPendingBattle(first.battleId, first.result.resultToken!, storage);
	assert.deepEqual(readPendingBattle(second.battleId, storage), second);
});

test('malformed or mismatched battle snapshots cannot restore a claim', () => {
	const storage = memoryStorage();
	const state = battle();
	const invalid = [
		'not json',
		'null',
		'[]',
		JSON.stringify({ ...state, version: 2 }),
		JSON.stringify({ ...state, seed: 54321 }),
		JSON.stringify({ ...state, targetDifficulty: 6 }),
		JSON.stringify({ ...state, samples: [null] }),
		JSON.stringify({ ...state, playerId: '' }),
		JSON.stringify({ ...state, result: { ...state.result, type: 'start' } }),
		JSON.stringify({ ...state, result: { ...state.result, resultToken: 'invalid' } }),
		JSON.stringify({ ...state, result: { ...state.result, opponentSamples: [null] } }),
		JSON.stringify({ ...state, result: { ...state.result, yourMatchPct: 101 } }),
		JSON.stringify({ ...state, result: { ...state.result, resultToken: undefined } })
	];
	for (const raw of invalid) {
		storage.setItem(pendingBattleKey(state.battleId), raw);
		assert.equal(readPendingBattle(state.battleId, storage), null, raw);
		assert.equal(storage.getItem(pendingBattleKey(state.battleId)), raw);
	}
});

test('unsigned older result may preserve its replay without being automatically reported', () => {
	const storage = memoryStorage();
	const state = battle();
	delete state.result.resultToken;
	state.pendingReport = false;
	assert.equal(writePendingBattle(state, storage), true);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
});

test('nonstandard cosmetic country codes do not prevent preserving the signed result', () => {
	const storage = memoryStorage();
	const state = { ...battle(), opponentCountry: 'T1' };
	assert.equal(writePendingBattle(state, storage), true);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
});

test('blocked/full storage is reported without deleting the currently preserved result', () => {
	const storage = memoryStorage();
	const state = battle();
	writePendingBattle(state, storage);
	const full: GameStorage = {
		...storage,
		setItem: () => {
			throw new Error('Quota exceeded');
		}
	};
	assert.equal(writePendingBattle({ ...state, showYou: true }, full), false);
	assert.deepEqual(readPendingBattle(state.battleId, storage), state);
	assert.equal(writePendingBattle(state, null), false);
	assert.equal(readPendingBattle(state.battleId, null), null);
	assert.equal(clearPendingBattle(state.battleId, state.result.resultToken!, null), false);
});
