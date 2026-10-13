/** A tab-scoped attempt survives OAuth, reloads, and navigation back to its level. */
export interface PendingGame {
	version: 2;
	levelParam: string;
	submissionId: string;
	samples: number[];
	totalClicks: number;
	elapsedMs: number;
	resetCount: number;
	showDialog: boolean;
	pendingSubmission: boolean;
	requestSent: boolean;
}

export type GameStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const LEGACY_KEY = 'macmac_game_state';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEVEL = /^(?:[1-9]\d*|g-[0-9a-z]+-\d+)$/;

export function newSubmissionId(): string {
	return globalThis.crypto.randomUUID();
}

export function pendingGameKey(levelParam: string): string {
	return `macmac_game_state:v2:${encodeURIComponent(levelParam)}`;
}

export function gameStorage(): GameStorage | null {
	try {
		return typeof window === 'undefined' ? null : window.sessionStorage;
	} catch {
		return null;
	}
}

function validNumbers(state: Record<string, unknown>): boolean {
	return (
		Array.isArray(state.samples) &&
		state.samples.length <= 10_000 &&
		state.samples.every((sample) => typeof sample === 'number' && Number.isFinite(sample)) &&
		Number.isSafeInteger(state.totalClicks) &&
		(state.totalClicks as number) >= state.samples.length &&
		typeof state.elapsedMs === 'number' &&
		Number.isFinite(state.elapsedMs) &&
		state.elapsedMs >= 0 &&
		Number.isSafeInteger(state.resetCount) &&
		(state.resetCount as number) >= 0 &&
		(!String(state.levelParam).startsWith('g-') || (state.resetCount as number) <= 3)
	);
}

function parsePendingGame(raw: string, levelParam: string, legacy = false): PendingGame | null {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const state = value as Record<string, unknown>;
	if (state.levelParam !== levelParam || !LEVEL.test(levelParam) || !validNumbers(state))
		return null;
	if (
		!legacy &&
		(state.version !== 2 ||
			typeof state.submissionId !== 'string' ||
			!UUID.test(state.submissionId) ||
			typeof state.showDialog !== 'boolean' ||
			typeof state.pendingSubmission !== 'boolean' ||
			typeof state.requestSent !== 'boolean')
	)
		return null;
	const samples = state.samples as number[];
	const showDialog = legacy ? samples.length > 0 : (state.showDialog as boolean);
	const pendingSubmission = legacy ? showDialog : (state.pendingSubmission as boolean);
	if (pendingSubmission && (!showDialog || samples.length === 0)) return null;
	return {
		version: 2,
		levelParam,
		submissionId: legacy ? newSubmissionId() : (state.submissionId as string),
		samples,
		totalClicks: state.totalClicks as number,
		elapsedMs: state.elapsedMs as number,
		resetCount: state.resetCount as number,
		showDialog,
		pendingSubmission,
		requestSent: legacy ? false : (state.requestSent as boolean)
	};
}

/** Reading never consumes a run: failed or cancelled sign-in can be retried. */
export function readPendingGame(levelParam: string, storage = gameStorage()): PendingGame | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(pendingGameKey(levelParam));
		if (raw !== null) return parsePendingGame(raw, levelParam);
		const legacy = storage.getItem(LEGACY_KEY);
		if (legacy === null) return null;
		const migrated = parsePendingGame(legacy, levelParam, true);
		if (migrated) writePendingGame(migrated, storage);
		return migrated;
	} catch {
		return null;
	}
}

export function writePendingGame(state: PendingGame, storage = gameStorage()): boolean {
	if (!storage) return false;
	try {
		const raw = JSON.stringify(state);
		if (!parsePendingGame(raw, state.levelParam)) return false;
		storage.setItem(pendingGameKey(state.levelParam), raw);
		return storage.getItem(pendingGameKey(state.levelParam)) === raw;
	} catch {
		return false;
	}
}

/** A late response from an older attempt must never remove its replacement. */
export function clearPendingGame(
	levelParam: string,
	submissionId: string,
	storage = gameStorage()
): boolean {
	if (!storage) return false;
	try {
		const current = readPendingGame(levelParam, storage);
		if (current?.submissionId !== submissionId) return false;
		storage.removeItem(pendingGameKey(levelParam));
		const legacy = storage.getItem(LEGACY_KEY);
		if (legacy && parsePendingGame(legacy, levelParam, true)) storage.removeItem(LEGACY_KEY);
		return true;
	} catch {
		return false;
	}
}
