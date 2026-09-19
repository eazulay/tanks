// Ad-hoc load test for the multiplayer relay. Not part of the build — run directly with node.
//
// Simulates N concurrent 2-player games: each pair connects, creates/joins a room,
// both click Start (skips the 30s countdown since 2/2 players have committed), then
// sends tank_state at TANK_STATE_HZ for GAME_DURATION_MS before leaving.
//
// Usage:
//   node scripts/load-test.mjs [wsUrl] [rooms] [rampMs] [durationMs]
//
// Examples:
//   node scripts/load-test.mjs wss://tanks.tiyal.com/ws 10 1000 60000   # external, through Apache
//   node scripts/load-test.mjs ws://127.0.0.1:3001/ws 10 1000 60000     # internal, on the VPS — isolates relay from Apache/network

import WebSocket from 'ws';

const WS_URL = process.argv[2] ?? 'wss://tanks.tiyal.com/ws';
const ROOMS = Number(process.argv[3] ?? 10);
const RAMP_MS = Number(process.argv[4] ?? 1000);
const GAME_DURATION_MS = Number(process.argv[5] ?? 60_000);
const TANK_STATE_HZ = 10;

let connected = 0;
let connectFailed = 0;
let roomsStarted = 0;
let roomsFailed = 0;

function makeClient() {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS_URL);
		const state = { ws, clientId: null, onMessage: null };
		ws.on('message', (raw) => {
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (msg.type === 'welcome' && !state.clientId) {
				state.clientId = msg.clientId;
				connected++;
				resolve(state);
			}
			state.onMessage?.(msg);
		});
		ws.on('error', (err) => {
			connectFailed++;
			reject(err);
		});
		setTimeout(() => {
			if (!state.clientId) reject(new Error('welcome timeout'));
		}, 5000);
	});
}

function send(ws, msg) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function tankState(index, t) {
	return {
		type: 'tank_state',
		index,
		x: Math.sin(t) * 50,
		y: 0,
		z: Math.cos(t) * 50,
		heading: t % (Math.PI * 2),
		turretHeading: 0,
		barrelElevation: 0,
		speed: 5,
		health: 100,
		destroyed: false
	};
}

async function runRoom(i) {
	let host, guest;
	try {
		host = await makeClient();
		guest = await makeClient();

		send(host.ws, { type: 'benchmark', score: 100 });
		send(guest.ws, { type: 'benchmark', score: 100 });
		send(host.ws, { type: 'set_name', name: `Bot${i}H` });
		send(guest.ws, { type: 'set_name', name: `Bot${i}G` });

		const roomId = await new Promise((resolve, reject) => {
			host.onMessage = (msg) => {
				if (msg.type === 'join_accepted') resolve(msg.room.roomId);
				if (msg.type === 'error') reject(new Error(`create_room: ${msg.message}`));
			};
			send(host.ws, { type: 'create_room' });
		});

		await new Promise((resolve, reject) => {
			host.onMessage = (msg) => {
				if (msg.type === 'join_requested') send(host.ws, { type: 'accept_join', clientId: msg.clientId });
			};
			guest.onMessage = (msg) => {
				if (msg.type === 'join_accepted') resolve();
				if (msg.type === 'join_rejected') reject(new Error(`join rejected: ${msg.reason}`));
			};
			send(guest.ws, { type: 'request_join', roomId });
		});

		const gs = await new Promise((resolve) => {
			host.onMessage = (msg) => {
				if (msg.type === 'game_start') resolve(msg);
			};
			send(host.ws, { type: 'click_start' });
			send(guest.ws, { type: 'click_start' });
		});

		roomsStarted++;

		const hostIndex = gs.assignments.find((a) => a.clientId === host.clientId)?.tankIndex ?? 0;
		const guestIndex = gs.assignments.find((a) => a.clientId === guest.clientId)?.tankIndex ?? 1;

		const tick = setInterval(() => {
			const t = Date.now() / 1000;
			send(host.ws, tankState(hostIndex, t));
			send(guest.ws, tankState(guestIndex, t + 0.5));
		}, 1000 / TANK_STATE_HZ);

		await new Promise((r) => setTimeout(r, GAME_DURATION_MS));
		clearInterval(tick);

		send(host.ws, { type: 'leave_room' });
		send(guest.ws, { type: 'leave_room' });
	} catch (err) {
		roomsFailed++;
		console.error(`room ${i} failed: ${err.message}`);
	} finally {
		host?.ws.close();
		guest?.ws.close();
	}
}

async function main() {
	console.log(
		`Ramping ${ROOMS} rooms (${ROOMS * 2} connections) against ${WS_URL}, ` +
			`one every ${RAMP_MS}ms, each running ${GAME_DURATION_MS}ms of tank_state at ${TANK_STATE_HZ}Hz`
	);

	const runs = [];
	for (let i = 0; i < ROOMS; i++) {
		runs.push(runRoom(i));
		await new Promise((r) => setTimeout(r, RAMP_MS));
	}

	const statusTimer = setInterval(() => {
		console.log(
			`[status] connected=${connected} connectFailed=${connectFailed} ` +
				`roomsStarted=${roomsStarted} roomsFailed=${roomsFailed}`
		);
	}, 5000);

	await Promise.all(runs);
	clearInterval(statusTimer);
	console.log(
		`[done] connected=${connected} connectFailed=${connectFailed} ` +
			`roomsStarted=${roomsStarted} roomsFailed=${roomsFailed}`
	);
}

main();
