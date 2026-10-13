/**
 * HMAC-SHA256 verification for battle result tokens.
 * Mirrors party/src/shared/crypto.ts — verify-only on the SvelteKit side.
 */

export interface BattleResultPayload {
	battleId: string;
	playerId: string;
	won: boolean;
	eloDelta: number;
	ts: number;
}

const TOKEN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const GUEST_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isGuestPlayerId(playerId: string): boolean {
	return /^anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId);
}

function fromBase64Url(str: string): Uint8Array {
	const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

async function getKey(secret: string): Promise<CryptoKey> {
	const enc = new TextEncoder();
	return crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify']
	);
}

/**
 * Verify a battle result token and return the payload if valid.
 * Returns null if signature is invalid or token is expired.
 */
export async function verifyBattleResult(
	token: string,
	secret: string
): Promise<BattleResultPayload | null> {
	const parts = token.split('.');
	if (parts.length !== 2) return null;

	const [payloadB64, sigB64] = parts;

	try {
		const key = await getKey(secret);
		const sigBytes = fromBase64Url(sigB64);
		const valid = await crypto.subtle.verify(
			'HMAC',
			key,
			sigBytes.buffer as ArrayBuffer,
			new TextEncoder().encode(payloadB64)
		);
		if (!valid) return null;

		const payloadBytes = fromBase64Url(payloadB64);
		const payloadStr = new TextDecoder().decode(payloadBytes);
		const payload: BattleResultPayload = JSON.parse(payloadStr);

		if (
			typeof payload.playerId !== 'string' ||
			!payload.playerId ||
			payload.playerId.length > 200 ||
			typeof payload.battleId !== 'string' ||
			!payload.battleId ||
			payload.battleId.length > 200 ||
			typeof payload.won !== 'boolean' ||
			!Number.isSafeInteger(payload.eloDelta) ||
			Math.abs(payload.eloDelta) > 50 ||
			!Number.isFinite(payload.ts) ||
			payload.ts < 0
		)
			return null;

		// A guest may need time to complete OAuth. Database receipts prevent replay.
		const maxAge = isGuestPlayerId(payload.playerId) ? GUEST_TOKEN_MAX_AGE_MS : TOKEN_MAX_AGE_MS;
		const age = Date.now() - payload.ts;
		if (age < -60000 || age > maxAge) return null;

		return payload;
	} catch {
		return null;
	}
}
