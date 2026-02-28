/**
 * Global battle queue store.
 *
 * Manages the matchmaker WebSocket connection as a module-level singleton
 * so it survives SvelteKit client-side navigation. The user can queue for
 * a battle, navigate to a solo level, and still get matched.
 */
import { writable, get } from 'svelte/store';
import { goto } from '$app/navigation';
import { joinMatchmaking, type MatchmakerMessage } from '$lib/battle/client';

export interface BattleQueueState {
	status: 'idle' | 'connecting' | 'searching' | 'match_found';
	waitingCount: number;
	opponentName: string | null;
	error: string | null;
}

const INITIAL: BattleQueueState = {
	status: 'idle',
	waitingCount: 0,
	opponentName: null,
	error: null
};

export const battleQueue = writable<BattleQueueState>(INITIAL);

// Socket ref lives at module level — not reactive, just a reference
let socket: ReturnType<typeof joinMatchmaking> | null = null;

/**
 * Join the matchmaker queue. No-op if already searching.
 */
export function startQueue(
	playerId: string,
	playerName: string,
	battleElo: number,
	country: string | null
): void {
	const current = get(battleQueue);
	if (current.status !== 'idle') return; // Already in queue

	battleQueue.set({
		status: 'connecting',
		waitingCount: 0,
		opponentName: null,
		error: null
	});

	socket = joinMatchmaking(
		playerId,
		playerName,
		battleElo,
		country,
		(msg: MatchmakerMessage) => {
			if (msg.type === 'queue_status') {
				battleQueue.set({
					status: 'searching',
					waitingCount: msg.waitingCount,
					opponentName: null,
					error: null
				});
			} else if (msg.type === 'match_found') {
				// 1. Close socket FIRST to prevent any ghost re-queuing
				if (socket) {
					socket.leave();
					socket = null;
				}
				// 2. Update store
				battleQueue.set({
					status: 'match_found',
					waitingCount: 0,
					opponentName: msg.opponentName,
					error: null
				});
				// 3. Navigate to battle
				goto(`/battle/${msg.battleId}`);
				// 4. Reset store after navigation settles
				setTimeout(() => {
					battleQueue.set(INITIAL);
				}, 500);
			}
		},
		() => {
			// Connection error — clean up and reset
			if (socket) {
				try { socket.leave(); } catch { /* ignore */ }
				socket = null;
			}
			battleQueue.set({
				status: 'idle',
				waitingCount: 0,
				opponentName: null,
				error: 'Connection error. Try again.'
			});
		}
	);
}

/**
 * Leave the matchmaker queue and clean up.
 */
export function cancelQueue(): void {
	if (socket) {
		socket.leave();
		socket = null;
	}
	battleQueue.set(INITIAL);
}
