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

		// Check expiry
		if (Date.now() - payload.ts > TOKEN_MAX_AGE_MS) return null;

		// Sanity: eloDelta must be within reasonable bounds (K=32 max)
		if (typeof payload.eloDelta !== 'number' || Math.abs(payload.eloDelta) > 50) return null;

		return payload;
	} catch {
		return null;
	}
}
