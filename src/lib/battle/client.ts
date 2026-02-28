/**
 * Battle client — wraps PartySocket connections for matchmaking and battles.
 */
import PartySocket from 'partysocket';
import type { ServerMessage } from './protocol';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';

/**
 * Lightweight HTTP poll: how many players are searching for a battle?
 * Returns 0 on any error so the indicator just hides gracefully.
 */
export async function fetchBattleQueueCount(): Promise<number> {
	try {
		const protocol = PARTYKIT_HOST.startsWith('localhost') ? 'http' : 'https';
		const res = await fetch(`${protocol}://${PARTYKIT_HOST}/parties/matchmaker/global`);
		if (!res.ok) return 0;
		const data = await res.json();
		return typeof data.searching === 'number' ? data.searching : 0;
	} catch {
		return 0;
	}
}

export type MatchmakerMessage =
	| { type: 'queue_status'; position: number; waitingCount: number }
	| { type: 'match_found'; battleId: string; seed: number; targetDifficulty: number; opponentName: string; opponentElo: number; opponentCountry?: string | null };

/**
 * Connect to the matchmaker queue.
 * Returns a socket and a cleanup function.
 */
export function joinMatchmaking(
	playerId: string,
	playerName: string,
	battleElo: number,
	country: string | null,
	onMessage: (msg: MatchmakerMessage) => void,
	onError?: (err: Event) => void
): { socket: PartySocket; leave: () => void } {
	const socket = new PartySocket({
		host: PARTYKIT_HOST,
		party: 'matchmaker',
		room: 'global'
	});

	socket.addEventListener('open', () => {
		socket.send(JSON.stringify({
			type: 'join_queue',
			playerId,
			playerName,
			battleElo,
			country
		}));
	});

	socket.addEventListener('message', (event) => {
		try {
			const msg = JSON.parse(event.data) as MatchmakerMessage;
			onMessage(msg);
		} catch { /* ignore */ }
	});

	if (onError) {
		socket.addEventListener('error', onError);
	}

	const leave = () => {
		try {
			socket.send(JSON.stringify({ type: 'leave_queue' }));
		} catch { /* ignore */ }
		socket.close();
	};

	return { socket, leave };
}

/**
 * Connect to a battle room.
 */
export function joinBattle(
	battleId: string,
	playerId: string,
	playerName: string,
	battleElo: number,
	country: string | null,
	onMessage: (msg: ServerMessage) => void,
	onError?: (err: Event) => void
): { socket: PartySocket; addSample: (x: number) => void; close: () => void } {
	const socket = new PartySocket({
		host: PARTYKIT_HOST,
		room: battleId
	});

	socket.addEventListener('open', () => {
		socket.send(JSON.stringify({
			type: 'join',
			playerId,
			playerName,
			battleElo,
			country
		}));
	});

	socket.addEventListener('message', (event) => {
		try {
			const msg = JSON.parse(event.data) as ServerMessage;
			onMessage(msg);
		} catch { /* ignore */ }
	});

	if (onError) {
		socket.addEventListener('error', onError);
	}

	const addSample = (x: number) => {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify({ type: 'add_sample', x }));
		}
	};

	const close = () => {
		socket.close();
	};

	return { socket, addSample, close };
}
