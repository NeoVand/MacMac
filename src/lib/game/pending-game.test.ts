import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clearPendingGame,
	newSubmissionId,
	pendingGameKey,
	readPendingGame,
	writePendingGame,
	type GameStorage,
	type PendingGame
} from './pending-game.ts';

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

function attempt(overrides: Partial<PendingGame> = {}): PendingGame {
	return {
		version: 2,
		levelParam: 'g-m1234-40',
		submissionId: newSubmissionId(),
		samples: [-1, 0, 0.8],
		totalClicks: 5,
		elapsedMs: 12_345,
		resetCount: 2,
		showDialog: true,
		pendingSubmission: true,
		requestSent: false,
		...overrides
	};
}

test('completed guest run survives repeated restoration without consumption or a new submission ID', () => {
	const storage = memoryStorage();
	const game = attempt();
	assert.equal(writePendingGame(game, storage), true);
	assert.deepEqual(readPendingGame(game.levelParam, storage), game);
	assert.deepEqual(readPendingGame(game.levelParam, storage), game);
	assert.notEqual(storage.getItem(pendingGameKey(game.levelParam)), null);
});

test('header sign-in preserves an unfinished run without marking it for auto-save', () => {
	const storage = memoryStorage();
	const game = attempt({ showDialog: false, pendingSubmission: false });
	writePendingGame(game, storage);
	const restored = readPendingGame(game.levelParam, storage);
	assert.deepEqual(restored, game);
	assert.equal(restored?.pendingSubmission, false);
	assert.equal(restored?.showDialog, false);
});

test('failed save remains recoverable with the same ID and a manually retryable result', () => {
	const storage = memoryStorage();
	const game = attempt();
	writePendingGame(game, storage);
	const retry = { ...game, requestSent: true, pendingSubmission: false };
	writePendingGame(retry, storage);
	assert.deepEqual(readPendingGame(game.levelParam, storage), retry);
	assert.equal(readPendingGame(game.levelParam, storage)?.submissionId, game.submissionId);
});

test('navigation to another level keeps each level attempt independently recoverable', () => {
	const storage = memoryStorage();
	const first = attempt();
	const second = attempt({ levelParam: '1', resetCount: 0 });
	writePendingGame(first, storage);
	writePendingGame(second, storage);
	assert.deepEqual(readPendingGame(first.levelParam, storage), first);
	assert.deepEqual(readPendingGame(second.levelParam, storage), second);
	assert.equal(readPendingGame('2', storage), null);
});

test('a stale successful response cannot delete a replacement attempt', () => {
	const storage = memoryStorage();
	const previous = attempt();
	const replacement = attempt();
	writePendingGame(previous, storage);
	writePendingGame(replacement, storage);
	assert.equal(clearPendingGame(previous.levelParam, previous.submissionId, storage), false);
	assert.deepEqual(readPendingGame(replacement.levelParam, storage), replacement);
});

test('only confirmation for the current attempt removes it, preserving other levels', () => {
	const storage = memoryStorage();
	const game = attempt();
	const other = attempt({ levelParam: '2' });
	writePendingGame(game, storage);
	writePendingGame(other, storage);
	assert.equal(clearPendingGame(game.levelParam, game.submissionId, storage), true);
	assert.equal(readPendingGame(game.levelParam, storage), null);
	assert.deepEqual(readPendingGame(other.levelParam, storage), other);
});

test('an explicit reset preserves its reset budget even before the next sample', () => {
	const storage = memoryStorage();
	const previous = attempt();
	writePendingGame(previous, storage);
	clearPendingGame(previous.levelParam, previous.submissionId, storage);
	const reset = attempt({
		samples: [],
		totalClicks: 0,
		elapsedMs: 0,
		resetCount: 3,
		showDialog: false,
		pendingSubmission: false
	});
	assert.notEqual(reset.submissionId, previous.submissionId);
	assert.equal(writePendingGame(reset, storage), true);
	assert.deepEqual(readPendingGame(reset.levelParam, storage), reset);
});

test('legacy OAuth snapshot migrates once while retaining a stable ID until confirmation', () => {
	const storage = memoryStorage();
	const game = attempt();
	storage.setItem(
		'macmac_game_state',
		JSON.stringify({
			levelParam: game.levelParam,
			samples: game.samples,
			totalClicks: game.totalClicks,
			elapsedMs: game.elapsedMs,
			resetCount: game.resetCount
		})
	);
	assert.equal(readPendingGame('1', storage), null);
	const migrated = readPendingGame(game.levelParam, storage);
	assert.ok(migrated);
	assert.equal(migrated.pendingSubmission, true);
	assert.equal(migrated.showDialog, true);
	assert.deepEqual(readPendingGame(game.levelParam, storage), migrated);
	assert.notEqual(storage.getItem('macmac_game_state'), null);
	assert.equal(clearPendingGame(game.levelParam, migrated.submissionId, storage), true);
	assert.equal(storage.getItem('macmac_game_state'), null);
	assert.equal(readPendingGame(game.levelParam, storage), null);
});

test('malformed snapshots cannot restore invalid state or trigger an automatic submission', () => {
	const storage = memoryStorage();
	const game = attempt();
	const malformed = [
		'bad json',
		'null',
		'[]',
		JSON.stringify({ ...game, version: 3 }),
		JSON.stringify({ ...game, levelParam: '1' }),
		JSON.stringify({ ...game, submissionId: 'invalid' }),
		JSON.stringify({ ...game, samples: [null] }),
		JSON.stringify({ ...game, totalClicks: 1 }),
		JSON.stringify({ ...game, elapsedMs: -1 }),
		JSON.stringify({ ...game, resetCount: 4 }),
		JSON.stringify({ ...game, showDialog: false }),
		JSON.stringify({ ...game, samples: [] })
	];
	for (const raw of malformed) {
		storage.setItem(pendingGameKey(game.levelParam), raw);
		assert.equal(readPendingGame(game.levelParam, storage), null, raw);
		assert.equal(storage.getItem(pendingGameKey(game.levelParam)), raw);
	}
});

test('unavailable, full, or disabled browser storage is reported without throwing', () => {
	const game = attempt();
	const blocked: GameStorage = {
		getItem: () => {
			throw new Error('Storage blocked');
		},
		setItem: () => {
			throw new Error('Storage full');
		},
		removeItem: () => {
			throw new Error('Storage blocked');
		}
	};
	for (const storage of [null, blocked]) {
		assert.equal(readPendingGame(game.levelParam, storage), null);
		assert.equal(writePendingGame(game, storage), false);
		assert.equal(clearPendingGame(game.levelParam, game.submissionId, storage), false);
	}
});

test('a refused write leaves the previous recoverable snapshot intact', () => {
	const storage = memoryStorage();
	const original = attempt();
	writePendingGame(original, storage);
	const readOnly: GameStorage = {
		...storage,
		setItem: () => {
			throw new Error('Quota exceeded');
		}
	};
	assert.equal(writePendingGame(attempt(), readOnly), false);
	assert.deepEqual(readPendingGame(original.levelParam, storage), original);
});
