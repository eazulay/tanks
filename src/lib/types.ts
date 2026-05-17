import type * as THREE from 'three';

export interface TankBody {
	uid: number;
	relayIndex: number; // -1 = AI or single-player; ≥0 = player's relay tankIndex
	x: number;
	y: number;
	z: number;
	pushVx: number;
	pushVz: number;
	hitAt: number | null;
	lastHit: { dist: number; wx: number; wz: number; splash?: boolean } | null;
	lastShellImpact: { x: number; z: number } | null; // terrain impact of own last shell, read by AI for correction
}

export interface SplashEntry {
	id: number;
	x: number;
	z: number;
}

export interface TankHealthEntry {
	health: number;
	destroyed: boolean;
	color: string;
	name: string;
}

export interface TreeVol {
	x: number;
	z: number;
	y: number;
	top: number;
	canopyR: number;
}

export interface TreeTrunk {
	x: number;
	z: number;
	r: number;
}

export interface ShellFollow {
	pos: THREE.Vector3 | null;
}

// ---------------------------------------------------------------------------
// Multiplayer wire protocol
// ---------------------------------------------------------------------------
//
// Message flow:
//   Client → Server  (ClientMessage): browser → relay
//   Server → Client  (ServerMessage): relay → browser
//
// In-game relay forwarding:
//   Host sends GameEventMessage variants as ClientMessage.
//   Relay forwards them unchanged to all guests as ServerMessage.
//   Guests send PlayerInputMsg as ClientMessage.
//   Relay attaches clientId and forwards to host as ServerMessage.

// --- Shared types ---

/** One player's slot inside a waiting room, as seen by room members. */
export interface RoomPlayer {
	clientId: string;
	name: string;
	colorIndex: number; // index into TANK_COLORS
	isHost: boolean;
}

/** Minimal room info broadcast to everyone in the lobby (not yet in a room). */
export interface RoomSummary {
	roomId: string;
	players: Pick<RoomPlayer, 'name' | 'colorIndex'>[];
	aiCount: number;
	playerCapacity: number; // max additional humans = 6 - aiCount - current humans
	locked: boolean; // true once countdown begins — no new joins
}

/** Full room state sent to members after any change. */
export interface RoomState {
	roomId: string;
	players: RoomPlayer[];
	aiCount: number;
	locked: boolean;
	countdownEndsAt: number | null; // Date.now() + 30 000 when countdown active, else null
	startClickerIds: string[]; // players who clicked Start Game
	cancelClickerIds: string[]; // subset of startClickerIds who clicked Cancel
}

/** Per-tank snapshot broadcast by host at ~20 Hz. */
export interface TankSnapshot {
	index: number;
	x: number;
	y: number;
	z: number;
	heading: number;
	turretHeading: number;
	barrelElevation: number;
	speed: number; // used for dead-reckoning and wheel/engine animation on remote clients
	health: number;
	destroyed: boolean;
}

// --- Client → Server messages ---

/**
 * Sent once on page load after the benchmark completes.
 * The relay uses this to pick the fastest machine as physics host when a game starts.
 * score is ops/ms — higher is better.
 */
type BenchmarkMsg = { type: 'benchmark'; score: number };

/** Player sets or updates their display name (persisted in localStorage by client). */
type SetNameMsg = { type: 'set_name'; name: string };

/** Player creates a new waiting room and becomes its host. */
type CreateRoomMsg = { type: 'create_room' };

/** Player requests to join a waiting room; existing members must accept. */
type RequestJoinMsg = { type: 'request_join'; roomId: string };

/** Any room member accepts a pending join request. */
type AcceptJoinMsg = { type: 'accept_join'; clientId: string };

/** Requester withdraws their own pending join request. */
type CancelJoinMsg = { type: 'cancel_join' };

/** Player voluntarily leaves their current room (treated the same as disconnect). */
type LeaveRoomMsg = { type: 'leave_room' };

/** Room creator locks or unlocks the room. Locked rooms reject new join requests. */
type LockRoomMsg = { type: 'lock_room'; locked: boolean };

/** Any room member changes the AI opponent count (0–4, locked after countdown starts). */
type SetAiCountMsg = { type: 'set_ai_count'; count: number };

/** Player picks a hull colour from those not yet taken by other room members. */
type SetColorMsg = { type: 'set_color'; colorIndex: number };

/** Player clicks Start Game — starts or joins the countdown. */
type ClickStartMsg = { type: 'click_start' };

/**
 * Player who previously clicked Start Game clicks Cancel.
 * Countdown stops only when ALL start-clickers have also clicked Cancel.
 */
type ClickCancelMsg = { type: 'click_cancel' };


/** Any player fired a shell; relay forwards to all others. */
type ShellFiredMsg = {
	type: 'shell_fired';
	shellId: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	tracked: boolean;
	firingBodyUid?: number; // UID of firing tank body — used on host for self-hit grace window
};

/** Shell left the world (OOB or impact); all clients should remove it. */
type ShellRemovedMsg = { type: 'shell_removed'; shellId: number };

/**
 * State broadcast by each player for their own tank at TANK_STATE_HZ.
 * Physics host also sends this for each AI tank.
 * index = relay tankIndex (matches game_start assignments).
 */
type TankStateMsg = { type: 'tank_state' } & TankSnapshot;

/** Physics host notifies all clients that a shell hit a specific tank. */
type TankHitMsg = {
	type: 'tank_hit';
	tankIndex: number; // relay tankIndex of the hit tank
	hitDist: number; // 0..HIT_RADIUS for damage calculation
	wx: number;
	wz: number;
	splash?: boolean;
};

/** Shell or tank destruction triggered an explosion. */
type ExplosionMsg = {
	type: 'explosion';
	x: number;
	y: number;
	z: number;
	tankExplosion: boolean;
	color: string; // hex string matching the destroyed tank's hull colour
};

/** Shell impact set a tree on fire. */
type TreeIgnitedMsg = { type: 'tree_ignited'; treeId: number };

/** Host detected game over. */
type GameOverMsg = { type: 'game_over' };

/** Relay elected a new physics host after the previous host disconnected. */
type TransferHostMsg = { type: 'transfer_host'; newHostClientId: string };

/** Broadcast to remaining in-game players when a non-host player disconnects mid-game. */
type PlayerLeftMsg = { type: 'player_left'; clientId: string; name: string };

export type ClientMessage =
	| BenchmarkMsg
	| SetNameMsg
	| CreateRoomMsg
	| RequestJoinMsg
	| AcceptJoinMsg
	| CancelJoinMsg
	| LeaveRoomMsg
	| LockRoomMsg
	| SetAiCountMsg
	| SetColorMsg
	| ClickStartMsg
	| ClickCancelMsg
	| TankStateMsg
	| TankHitMsg
	| ShellFiredMsg
	| ShellRemovedMsg
	| ExplosionMsg
	| TreeIgnitedMsg
	| GameOverMsg;

// --- Server → Client messages ---

/** Sent immediately on connection. clientId is stable for the session. */
type WelcomeMsg = { type: 'welcome'; clientId: string };

/** Full lobby snapshot sent to unroomed clients after any room changes. */
type LobbyUpdateMsg = { type: 'lobby_update'; rooms: RoomSummary[] };

/** Full room snapshot sent to room members after any room state change. */
type RoomUpdateMsg = { type: 'room_update'; room: RoomState };

/** Broadcast to room members when an outsider requests to join. */
type JoinRequestedMsg = { type: 'join_requested'; clientId: string; name: string };

/** Sent to the requester when a room member accepts their join request. */
type JoinAcceptedMsg = { type: 'join_accepted'; room: RoomState };

/** Sent to the requester when their join request cannot be fulfilled. */
type JoinRejectedMsg = { type: 'join_rejected'; reason: 'locked' | 'full' | 'not_found' };

/** Broadcast to room members when a pending join request is withdrawn or the requester disconnects. */
type JoinCancelledMsg = { type: 'join_cancelled'; clientId: string };

/** Sent to all room members when the countdown is aborted before reaching zero. */
type CountdownCancelledMsg = {
	type: 'countdown_cancelled';
	reason: 'unanimous_cancel' | 'too_few_players';
};

/** Sent to players who did not click Start Game before the countdown elapsed. */
type KickedMsg = { type: 'kicked'; reason: 'countdown_elapsed' };

/**
 * Sent to all room members when the game is starting.
 * All clients call mulberry32(seed) to reproduce identical terrain and spawns.
 * assignments maps each human player to their tank slot and colour.
 * AI tanks fill remaining slots and are coloured automatically.
 */
type GameStartMsg = {
	type: 'game_start';
	seed: number;
	hostClientId: string;
	aiCount: number;
	assignments: { clientId: string; tankIndex: number; colorIndex: number; name: string }[];
};

/** Relay reporting a protocol or validation error to the sender. */
type ErrorMsg = { type: 'error'; code: string; message: string };

export type ServerMessage =
	| WelcomeMsg
	| LobbyUpdateMsg
	| RoomUpdateMsg
	| JoinRequestedMsg
	| JoinAcceptedMsg
	| JoinRejectedMsg
	| JoinCancelledMsg
	| CountdownCancelledMsg
	| KickedMsg
	| GameStartMsg
	| ErrorMsg
	| TankStateMsg
	| TankHitMsg
	| ShellFiredMsg
	| ShellRemovedMsg
	| ExplosionMsg
	| TreeIgnitedMsg
	| GameOverMsg
	| TransferHostMsg
	| PlayerLeftMsg;

// --- Helpers ---

/** Parse a raw WebSocket message string into a typed message, or null if malformed. */
export function parseMessage(raw: string): ClientMessage | ServerMessage | null {
	try {
		const msg = JSON.parse(raw);
		if (msg && typeof msg.type === 'string') return msg as ClientMessage | ServerMessage;
		return null;
	} catch {
		return null;
	}
}

/** Serialise a message for sending over the wire. */
export function encodeMessage(msg: ClientMessage | ServerMessage): string {
	return JSON.stringify(msg);
}
