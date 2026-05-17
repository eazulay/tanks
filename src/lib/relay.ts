// Relay server — runs in Node.js only (imported by vite.config.ts dev plugin and server.js).
// Manages in-memory rooms; no message ever crosses room boundaries.

import { randomUUID } from 'crypto';
import type { WebSocketServer, WebSocket } from 'ws';
import { encodeMessage, parseMessage } from './types.js';
import type { ClientMessage, ServerMessage, RoomPlayer, RoomState, RoomSummary } from './types.js';

// ---------------------------------------------------------------------------
// Internal state types
// ---------------------------------------------------------------------------

interface RelayClient {
	clientId: string;
	ws: WebSocket;
	name: string;
	benchmarkScore: number;
	roomId: string | null; // null = browsing lobby
}

interface PendingJoin {
	clientId: string;
	name: string;
}

interface RelayRoom {
	roomId: string;
	playerIds: string[]; // insertion order; index 0 is room creator
	hostClientId: string | null; // null until game starts; set to winner of benchmark vote
	colors: Map<string, number>; // clientId → colorIndex
	aiCount: number;
	manuallyLocked: boolean; // set by room creator independent of countdown
	locked: boolean; // true when manuallyLocked OR countdown is active
	pendingJoins: Map<string, PendingJoin>; // clientId → join request
	countdownTimer: ReturnType<typeof setTimeout> | null;
	countdownEndsAt: number | null;
	startClickerIds: Set<string>;
	cancelClickerIds: Set<string>;
	gameStarted: boolean;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const clients = new Map<string, RelayClient>();
const rooms = new Map<string, RelayRoom>();

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

function send(ws: WebSocket, msg: ServerMessage): void {
	if (ws.readyState === 1 /* OPEN */) ws.send(encodeMessage(msg));
}

function sendTo(clientId: string, msg: ServerMessage): void {
	const client = clients.get(clientId);
	if (client) send(client.ws, msg);
}

/** Broadcast to every player in the room, optionally excluding one. */
function broadcastRoom(roomId: string, msg: ServerMessage, excludeId?: string): void {
	const room = rooms.get(roomId);
	if (!room) return;
	for (const id of room.playerIds) {
		if (id !== excludeId) sendTo(id, msg);
	}
}

/** Broadcast lobby snapshot to every client not currently in a room. */
function broadcastLobby(): void {
	const msg: ServerMessage = { type: 'lobby_update', rooms: buildLobbySummaries() };
	for (const client of clients.values()) {
		if (client.roomId === null) send(client.ws, msg);
	}
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function buildLobbySummaries(): RoomSummary[] {
	const result: RoomSummary[] = [];
	for (const room of rooms.values()) {
		if (!room.gameStarted) result.push(buildRoomSummary(room));
	}
	return result;
}

function buildRoomSummary(room: RelayRoom): RoomSummary {
	return {
		roomId: room.roomId,
		players: room.playerIds.map((id) => ({
			name: clients.get(id)?.name ?? '',
			colorIndex: room.colors.get(id) ?? 0
		})),
		aiCount: room.aiCount,
		playerCapacity: Math.max(0, maxHumans(room) - room.playerIds.length),
		locked: room.locked
	};
}

function buildRoomState(room: RelayRoom): RoomState {
	const players: RoomPlayer[] = room.playerIds.map((id, i) => ({
		clientId: id,
		name: clients.get(id)?.name ?? '',
		colorIndex: room.colors.get(id) ?? i,
		isHost: i === 0 // room creator shown as host in the waiting room UI
	}));
	return {
		roomId: room.roomId,
		players,
		aiCount: room.aiCount,
		locked: room.locked,
		countdownEndsAt: room.countdownEndsAt,
		startClickerIds: Array.from(room.startClickerIds),
		cancelClickerIds: Array.from(room.cancelClickerIds)
	};
}

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

function generateRoomId(): string {
	// Unambiguous characters: no 0/O or 1/I
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let id: string;
	do {
		id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
	} while (rooms.has(id));
	return id;
}

function maxHumans(room: RelayRoom): number {
	return 6 - room.aiCount;
}

function firstAvailableColor(room: RelayRoom): number {
	const taken = new Set(room.colors.values());
	for (let i = 0; i < 6; i++) if (!taken.has(i)) return i;
	return 0;
}

/** Pick the connected player with the highest benchmark score to be physics host. */
function electHost(room: RelayRoom): string {
	let bestId = room.playerIds[0];
	let bestScore = -1;
	for (const id of room.playerIds) {
		const score = clients.get(id)?.benchmarkScore ?? 0;
		if (score > bestScore) {
			bestScore = score;
			bestId = id;
		}
	}
	return bestId;
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function removeFromRoom(clientId: string): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;

	const room = rooms.get(client.roomId);
	if (!room) {
		client.roomId = null;
		return;
	}

	const { roomId } = room;

	// Remove from player list and color map
	const idx = room.playerIds.indexOf(clientId);
	if (idx !== -1) room.playerIds.splice(idx, 1);
	room.colors.delete(clientId);

	const wasStarter = room.startClickerIds.delete(clientId);
	room.cancelClickerIds.delete(clientId);
	client.roomId = null;

	if (room.playerIds.length === 0) {
		dissolveRoom(roomId);
		return;
	}

	if (room.gameStarted) {
		if (room.hostClientId === clientId) {
			// Host disconnect: elect the first remaining connected client as new host
			const newHostId = room.playerIds.find((id) => {
				const c = clients.get(id);
				return c != null && c.ws.readyState === 1; // WebSocket.OPEN
			});
			if (newHostId) {
				room.hostClientId = newHostId;
				broadcastRoom(roomId, { type: 'transfer_host', newHostClientId: newHostId });
			} else {
				dissolveRoom(roomId);
			}
		} else {
			// Non-host disconnect: notify remaining players so they can update their HUD
			broadcastRoom(roomId, { type: 'player_left', clientId, name: client.name });
		}
		return;
	}

	// During countdown, check termination conditions
	if (room.countdownTimer !== null) {
		if (room.playerIds.length < 2) {
			cancelCountdown(room, 'too_few_players');
			return;
		}
		// Unanimous cancel if all remaining starters have clicked cancel
		if (wasStarter && room.startClickerIds.size > 0 &&
			room.cancelClickerIds.size >= room.startClickerIds.size) {
			cancelCountdown(room, 'unanimous_cancel');
			return;
		}
	}

	broadcastRoom(roomId, { type: 'room_update', room: buildRoomState(room) });
	broadcastLobby();
}

function dissolveRoom(roomId: string): void {
	const room = rooms.get(roomId);
	if (!room) return;
	if (room.countdownTimer) clearTimeout(room.countdownTimer);
	rooms.delete(roomId);
	broadcastLobby();
}

function cancelCountdown(room: RelayRoom, reason: 'unanimous_cancel' | 'too_few_players'): void {
	if (room.countdownTimer) {
		clearTimeout(room.countdownTimer);
		room.countdownTimer = null;
	}
	room.countdownEndsAt = null;
	room.locked = room.manuallyLocked; // restore host's manual lock state
	room.startClickerIds.clear();
	room.cancelClickerIds.clear();
	broadcastRoom(room.roomId, { type: 'countdown_cancelled', reason });
	broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
	broadcastLobby();
}

function onCountdownElapsed(roomId: string): void {
	const room = rooms.get(roomId);
	if (!room) return;
	room.countdownTimer = null;
	room.countdownEndsAt = null;

	// Kick non-starters
	const nonStarters = room.playerIds.filter((id) => !room.startClickerIds.has(id));
	for (const id of nonStarters) {
		sendTo(id, { type: 'kicked', reason: 'countdown_elapsed' });
		const kicked = clients.get(id);
		if (kicked) kicked.roomId = null;
	}
	room.playerIds = room.playerIds.filter((id) => room.startClickerIds.has(id));
	for (const id of nonStarters) room.colors.delete(id);

	if (room.playerIds.length < 2) {
		// Not enough players survived — cancel instead of starting
		room.locked = false;
		room.startClickerIds.clear();
		room.cancelClickerIds.clear();
		broadcastRoom(roomId, { type: 'countdown_cancelled', reason: 'too_few_players' });
		broadcastRoom(roomId, { type: 'room_update', room: buildRoomState(room) });
		broadcastLobby();
		return;
	}

	launchGame(room);
}

function launchGame(room: RelayRoom): void {
	if (room.countdownTimer) {
		clearTimeout(room.countdownTimer);
		room.countdownTimer = null;
	}

	room.gameStarted = true;
	room.hostClientId = electHost(room);

	const seed = (Math.random() * 2 ** 32) | 0;

	// Host gets tank index 0 to match single-player conventions; others follow in room order
	const ordered = [room.hostClientId, ...room.playerIds.filter((id) => id !== room.hostClientId)];
	const assignments = ordered.map((clientId, tankIndex) => ({
		clientId,
		tankIndex,
		colorIndex: room.colors.get(clientId) ?? tankIndex,
		name: clients.get(clientId)?.name ?? 'Player'
	}));

	broadcastRoom(room.roomId, {
		type: 'game_start',
		seed,
		hostClientId: room.hostClientId,
		aiCount: room.aiCount,
		assignments
	});
	broadcastLobby(); // remove room from lobby list for newly connecting clients
}

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

function handleBenchmark(clientId: string, score: number): void {
	const client = clients.get(clientId);
	if (client) client.benchmarkScore = score;
}

function handleSetName(clientId: string, name: string): void {
	const client = clients.get(clientId);
	if (!client) return;
	client.name = name.trim().slice(0, 24) || 'Tank';
	if (client.roomId) {
		const room = rooms.get(client.roomId);
		if (room) broadcastRoom(client.roomId, { type: 'room_update', room: buildRoomState(room) });
	}
	broadcastLobby();
}

function handleCreateRoom(clientId: string): void {
	const client = clients.get(clientId);
	if (!client || client.roomId) return; // already in a room

	const roomId = generateRoomId();
	const room: RelayRoom = {
		roomId,
		playerIds: [clientId],
		hostClientId: null,
		colors: new Map([[clientId, 0]]),
		aiCount: 0,
		manuallyLocked: false,
		locked: false,
		pendingJoins: new Map(),
		countdownTimer: null,
		countdownEndsAt: null,
		startClickerIds: new Set(),
		cancelClickerIds: new Set(),
		gameStarted: false
	};
	rooms.set(roomId, room);
	client.roomId = roomId;

	send(client.ws, { type: 'join_accepted', room: buildRoomState(room) });
	broadcastLobby();
}

function handleRequestJoin(clientId: string, roomId: string): void {
	const client = clients.get(clientId);
	if (!client || client.roomId) return;

	const room = rooms.get(roomId);
	if (!room) { sendTo(clientId, { type: 'join_rejected', reason: 'not_found' }); return; }
	if (room.locked) { sendTo(clientId, { type: 'join_rejected', reason: 'locked' }); return; }
	if (room.playerIds.length >= maxHumans(room)) { sendTo(clientId, { type: 'join_rejected', reason: 'full' }); return; }

	room.pendingJoins.set(clientId, { clientId, name: client.name });
	broadcastRoom(roomId, { type: 'join_requested', clientId, name: client.name });
}

function handleCancelJoin(clientId: string): void {
	for (const room of rooms.values()) {
		if (room.pendingJoins.delete(clientId)) {
			broadcastRoom(room.roomId, { type: 'join_cancelled', clientId });
		}
	}
}

function handleAcceptJoin(acceptorId: string, targetId: string): void {
	const acceptor = clients.get(acceptorId);
	if (!acceptor?.roomId) return;

	const room = rooms.get(acceptor.roomId);
	if (!room || room.locked || !room.playerIds.includes(acceptorId)) return;
	if (!room.pendingJoins.has(targetId)) return;

	if (room.playerIds.length >= maxHumans(room)) {
		sendTo(targetId, { type: 'join_rejected', reason: 'full' });
		room.pendingJoins.delete(targetId);
		return;
	}

	const target = clients.get(targetId);
	if (!target) { room.pendingJoins.delete(targetId); return; }

	room.pendingJoins.delete(targetId);
	room.playerIds.push(targetId);
	room.colors.set(targetId, firstAvailableColor(room));
	target.roomId = acceptor.roomId;

	const state = buildRoomState(room);
	send(target.ws, { type: 'join_accepted', room: state });
	broadcastRoom(room.roomId, { type: 'room_update', room: state }, targetId);

	// If room is now full, reject remaining pending requests
	if (room.playerIds.length >= maxHumans(room)) {
		for (const [pendingId] of room.pendingJoins) sendTo(pendingId, { type: 'join_rejected', reason: 'full' });
		room.pendingJoins.clear();
	}

	broadcastLobby();
}

function handleLockRoom(clientId: string, locked: boolean): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room || room.countdownTimer !== null) return;
	if (room.playerIds[0] !== clientId) return; // only room creator
	room.manuallyLocked = locked;
	room.locked = locked;
	if (locked) {
		for (const [pendingId] of room.pendingJoins) sendTo(pendingId, { type: 'join_rejected', reason: 'locked' });
		room.pendingJoins.clear();
	}
	broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
	broadcastLobby();
}

function handleLeaveRoom(clientId: string): void {
	removeFromRoom(clientId);
}

function handleSetAiCount(clientId: string, count: number): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room || room.locked) return;

	const clamped = Math.max(0, Math.min(4, count, 6 - room.playerIds.length));
	if (clamped === room.aiCount) return;
	room.aiCount = clamped;

	// Newly over-capacity pending requests must be rejected
	if (room.playerIds.length >= maxHumans(room)) {
		for (const [pendingId] of room.pendingJoins) sendTo(pendingId, { type: 'join_rejected', reason: 'full' });
		room.pendingJoins.clear();
	}

	broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
	broadcastLobby();
}

function handleSetColor(clientId: string, colorIndex: number): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room) return;

	for (const [id, idx] of room.colors) {
		if (id !== clientId && idx === colorIndex) return; // color already taken
	}

	room.colors.set(clientId, colorIndex);
	broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
}

function handleClickStart(clientId: string): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room || room.gameStarted || !room.playerIds.includes(clientId)) return;
	if (room.startClickerIds.has(clientId)) return;

	const isFirst = room.startClickerIds.size === 0;
	room.startClickerIds.add(clientId);

	if (isFirst) {
		room.locked = true;
		room.countdownEndsAt = Date.now() + 30_000;
		room.countdownTimer = setTimeout(() => onCountdownElapsed(room.roomId), 30_000);
		for (const [pendingId] of room.pendingJoins) sendTo(pendingId, { type: 'join_rejected', reason: 'locked' });
		room.pendingJoins.clear();
	}

	// All players committed — no need to wait out the countdown
	if (room.startClickerIds.size === room.playerIds.length && room.playerIds.length >= 2) {
		launchGame(room);
		return;
	}

	broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
}

function handleClickCancel(clientId: string): void {
	const client = clients.get(clientId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room || !room.countdownTimer || !room.startClickerIds.has(clientId)) return;

	room.cancelClickerIds.add(clientId);

	if (room.cancelClickerIds.size >= room.startClickerIds.size) {
		cancelCountdown(room, 'unanimous_cancel');
	} else {
		broadcastRoom(room.roomId, { type: 'room_update', room: buildRoomState(room) });
	}
}

// ---------------------------------------------------------------------------
// In-game message forwarding
// ---------------------------------------------------------------------------

/** Host → relay → all players (tank_hit, shell events, explosions, game_over). */
function forwardToGuests(senderId: string, msg: ClientMessage): void {
	const client = clients.get(senderId);
	if (!client?.roomId) return;
	// Only forward if the sender is the current host
	const room = rooms.get(client.roomId);
	if (!room || room.hostClientId !== senderId) return;
	broadcastRoom(client.roomId, msg as unknown as ServerMessage, senderId);

	if (msg.type === 'game_over') dissolveRoom(client.roomId);
}

/** Any player → relay → all other players. */
function forwardToAll(senderId: string, msg: ClientMessage): void {
	const client = clients.get(senderId);
	if (!client?.roomId) return;
	const room = rooms.get(client.roomId);
	if (!room?.gameStarted) return;
	broadcastRoom(client.roomId, msg as unknown as ServerMessage, senderId);
	if (msg.type === 'game_over') dissolveRoom(client.roomId);
}

// ---------------------------------------------------------------------------
// Main message router
// ---------------------------------------------------------------------------

function handleMessage(clientId: string, raw: string): void {
	const msg = parseMessage(raw);
	if (!msg) return;

	switch (msg.type) {
		case 'benchmark':     return handleBenchmark(clientId, msg.score);
		case 'set_name':      return handleSetName(clientId, msg.name);
		case 'create_room':   return handleCreateRoom(clientId);
		case 'request_join':  return handleRequestJoin(clientId, msg.roomId);
		case 'accept_join':   return handleAcceptJoin(clientId, msg.clientId);
		case 'cancel_join':   return handleCancelJoin(clientId);
		case 'leave_room':    return handleLeaveRoom(clientId);
		case 'lock_room':     return handleLockRoom(clientId, msg.locked);
		case 'set_ai_count':  return handleSetAiCount(clientId, msg.count);
		case 'set_color':     return handleSetColor(clientId, msg.colorIndex);
		case 'click_start':   return handleClickStart(clientId);
		case 'click_cancel':  return handleClickCancel(clientId);
		case 'tank_state':
		case 'shell_fired':
		case 'tank_hit':
		case 'shell_removed':
		case 'explosion':
		case 'tree_ignited':
		case 'game_over':     return forwardToAll(clientId, msg);
		// ServerMessage variants arriving from the wire are silently ignored
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createRelay(wss: WebSocketServer): void {
	wss.on('connection', (ws: WebSocket) => {
		const clientId = randomUUID();
		const client: RelayClient = { clientId, ws, name: 'Tank', benchmarkScore: 0, roomId: null };
		clients.set(clientId, client);

		send(ws, { type: 'welcome', clientId });
		send(ws, { type: 'lobby_update', rooms: buildLobbySummaries() });

		ws.on('message', (data) => handleMessage(clientId, data.toString()));
		ws.on('close', () => { removeFromRoom(clientId); handleCancelJoin(clientId); clients.delete(clientId); });
		ws.on('error', () => { removeFromRoom(clientId); handleCancelJoin(clientId); clients.delete(clientId); });
	});
}
