// Multiplayer WebSocket store — module-level singleton, persists across client-side navigation.

import { browser } from '$app/environment';
import { parseMessage, encodeMessage } from './types.js';
import type { ClientMessage, ServerMessage, RoomSummary, RoomState, TankSnapshot } from './types.js';

export const TANK_COLORS = ['#CBFF70', '#FFD060', '#80CCFF', '#FF8055', '#CC80FF', '#60FFD0'] as const;

/** How many times per second each client broadcasts its own tank state. */
export const TANK_STATE_HZ = 10;

export type GameStart = {
	seed: number;
	hostClientId: string;
	aiCount: number;
	assignments: { clientId: string; tankIndex: number; colorIndex: number; name: string }[];
};

export const mp = $state({
	connected: false,
	clientId: null as string | null,
	rooms: [] as RoomSummary[],
	room: null as RoomState | null,
	pendingRoomId: null as string | null,
	joinError: null as 'locked' | 'full' | 'not_found' | null,
	pendingJoiners: [] as { clientId: string; name: string }[],
	kicked: false,
	gameStart: null as GameStart | null,
	latestPlayerLeft: null as { clientId: string; name: string } | null,
});

let _ws: WebSocket | null = null;
let _connectedAs = ''; // name used for the current connection in this window

export function send(msg: ClientMessage): void {
	if (_ws?.readyState === 1) _ws.send(encodeMessage(msg));
}

// ---------------------------------------------------------------------------
// In-game event handlers — set by Scene.svelte during gameplay, cleared on destroy.
// Using a mutable object so the reference stays stable across module re-evaluations.
// ---------------------------------------------------------------------------

export interface GameHandlers {
	onTankState?: (snapshot: TankSnapshot) => void;
	onTankHit?: (tankIndex: number, hitDist: number, wx: number, wz: number, splash?: boolean) => void;
	onShellFired?: (shellId: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, firingBodyUid?: number) => void;
	onShellRemoved?: (shellId: number) => void;
	onExplosion?: (x: number, y: number, z: number, tankExplosion: boolean, color: string) => void;
	onTreeIgnited?: (treeId: number) => void;
	onGameOver?: () => void;
	onTransferHost?: (newHostClientId: string) => void;
}

let _gameHandlers: GameHandlers | null = null;

export function setGameHandlers(h: GameHandlers | null): void {
	_gameHandlers = h;
}

function handle(msg: ServerMessage): void {
	switch (msg.type) {
		case 'welcome':
			mp.clientId = msg.clientId;
			break;
		case 'lobby_update':
			mp.rooms = msg.rooms;
			break;
		case 'room_update': {
			mp.room = msg.room;
			const inRoom = new Set(msg.room.players.map((p) => p.clientId));
			mp.pendingJoiners = mp.pendingJoiners.filter((j) => !inRoom.has(j.clientId));
			break;
		}
		case 'join_accepted':
			mp.room = msg.room;
			mp.joinError = null;
			mp.pendingRoomId = null;
			break;
		case 'join_rejected':
			mp.joinError = msg.reason;
			mp.pendingRoomId = null;
			break;
		case 'join_requested':
			mp.pendingJoiners = [...mp.pendingJoiners, { clientId: msg.clientId, name: msg.name }];
			break;
		case 'join_cancelled':
			mp.pendingJoiners = mp.pendingJoiners.filter((j) => j.clientId !== msg.clientId);
			break;
		case 'kicked':
			mp.kicked = true;
			mp.room = null;
			break;
		case 'game_start': {
			const gs: GameStart = {
				seed: msg.seed,
				hostClientId: msg.hostClientId,
				aiCount: msg.aiCount,
				assignments: msg.assignments,
			};
			mp.gameStart = gs;
			// Mirror to sessionStorage so the game page can read it even after a full-page reload
			if (browser) {
				sessionStorage.setItem('mp_gameStart', JSON.stringify(gs));
				sessionStorage.setItem('mp_clientId', mp.clientId ?? '');
			}
			break;
		}
		case 'countdown_cancelled':
			// room_update follows immediately with the updated state
			break;
		case 'player_left':
			mp.latestPlayerLeft = { clientId: msg.clientId, name: msg.name };
			break;

		// --- In-game events forwarded to Scene ---
		case 'tank_state':
			_gameHandlers?.onTankState?.(msg as unknown as TankSnapshot);
			break;
		case 'tank_hit':
			_gameHandlers?.onTankHit?.(msg.tankIndex, msg.hitDist, msg.wx, msg.wz, msg.splash);
			break;
		case 'shell_fired':
			_gameHandlers?.onShellFired?.(
				msg.shellId,
				msg.x,
				msg.y,
				msg.z,
				msg.vx,
				msg.vy,
				msg.vz,
				msg.firingBodyUid
			);
			break;
		case 'shell_removed':
			_gameHandlers?.onShellRemoved?.(msg.shellId);
			break;
		case 'explosion':
			_gameHandlers?.onExplosion?.(msg.x, msg.y, msg.z, msg.tankExplosion, msg.color);
			break;
		case 'tree_ignited':
			_gameHandlers?.onTreeIgnited?.(msg.treeId);
			break;
		case 'game_over':
			_gameHandlers?.onGameOver?.();
			break;
		case 'transfer_host':
			_gameHandlers?.onTransferHost?.(msg.newHostClientId);
			break;
	}
}

/** Explicitly update the display name for the current connection.
 * Call this when the user intentionally changes their name (e.g. on the home page).
 * Safe to call when disconnected — the name is remembered for the next connect(). */
export function updateName(name: string): void {
	_connectedAs = name;
	send({ type: 'set_name', name });
}

export function connect(name: string): void {
	if (!browser) return;
	if (_ws && (_ws.readyState === 0 || _ws.readyState === 1)) {
		// Already connected — name is managed by updateName(), not re-read from localStorage here.
		// Re-reading localStorage would pick up name changes from other windows/tabs.
		return;
	}

	// Use the name this window's user last set explicitly; fall back to the passed value
	// (which comes from localStorage on first connection in this window).
	_connectedAs = _connectedAs || name;

	const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
	_ws = new WebSocket(`${protocol}//${location.host}/ws`);

	_ws.onopen = () => {
		mp.connected = true;
		send({ type: 'set_name', name: _connectedAs });
		// CPU benchmark for physics host election (~50 ms)
		const t0 = performance.now();
		let ops = 0;
		while (performance.now() - t0 < 50) {
			Math.sin(ops * 0.1) * Math.cos(ops * 0.2);
			ops++;
		}
		send({ type: 'benchmark', score: ops / 50 });
	};

	_ws.onmessage = (e) => {
		const msg = parseMessage(e.data);
		if (msg) handle(msg as ServerMessage);
	};

	_ws.onclose = () => {
		mp.connected = false;
		mp.room = null;
		_ws = null;
	};

	_ws.onerror = () => {
		mp.connected = false;
		_ws = null;
	};
}

export function leaveRoom(): void {
	send({ type: 'leave_room' });
	mp.room = null;
	mp.pendingJoiners = [];
}

export function disconnect(): void {
	_ws?.close();
	_ws = null;
	_connectedAs = '';
	mp.connected = false;
	mp.clientId = null;
	mp.rooms = [];
	mp.room = null;
	mp.pendingRoomId = null;
	mp.joinError = null;
	mp.pendingJoiners = [];
	mp.kicked = false;
	mp.gameStart = null;
}
