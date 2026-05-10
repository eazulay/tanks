<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { Object3D } from 'three';
	import Splash from './Splash.svelte';
	import Flames from './Flames.svelte';
	import type { TankBody } from './types';

	let {
		controlled = false,
		chaseCamera = false,
		gameOver = false,
		spawnX = 0,
		spawnZ = 0,
		spawnHeading = 0,
		tankColor = '#CBFF70',
		onfire = undefined as
			| ((position: THREE.Vector3, velocity: THREE.Vector3, firingBodyUid: number) => void)
			| undefined,
		onexplode = undefined as ((position: THREE.Vector3, color: string) => void) | undefined,
		onhealthchange = undefined as ((health: number, destroyed: boolean) => void) | undefined
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const treeTrunks = getContext<{ x: number; z: number; r: number }[]>('treeTrunks');
	const tankBodies = getContext<TankBody[]>('tankBodies');
	const shellFollow = getContext<{ pos: THREE.Vector3 | null }>('shellFollow');
	const audioListener = getContext<THREE.AudioListener>('audioListener') ?? null;
	const audioBuffers = getContext<{ engine: AudioBuffer | null; shot: AudioBuffer | null; shellFly: AudioBuffer | null; treeFire: AudioBuffer | null }>('audioBuffers') ?? null;

	let engineSound: THREE.PositionalAudio | null = null;
	let shotSound: THREE.PositionalAudio | null = null;
	if (audioListener) {
		engineSound = new THREE.PositionalAudio(audioListener);
		engineSound.setRefDistance(30);
		engineSound.setLoop(true);
		engineSound.setVolume(0.6);

		shotSound = new THREE.PositionalAudio(audioListener);
		shotSound.setRefDistance(40);
		shotSound.setMaxDistance(600);
		shotSound.setVolume(1.0);
	}

	// Register this tank's body; other tanks write impulses here, we apply + decay them each frame.
	// hitAt is written by Shell when a shell strikes us, triggering the fire+explosion sequence.
	const ownBody = {
		uid: Math.floor(Math.random() * 0xffffffff),
		x: spawnX,
		y: 0,
		z: spawnZ,
		pushVx: 0,
		pushVz: 0,
		hitAt: null as number | null,
		lastHit: null as { dist: number; wx: number; wz: number; splash?: boolean } | null,
		lastShellImpact: null as { x: number; z: number } | null
	};
	tankBodies?.push(ownBody);

	// --- Constants ---
	const ACCEL = 4;
	const BRAKE_DECEL = 6;
	const TURN_SPEED = 1.5; // radians per second
	const TURRET_SPEED = 1.2; // radians per second
	const BARREL_SPEED = 0.8; // radians per second
	const BARREL_MIN = -0.17; // ~-10°
	const BARREL_MAX = 0.875; // ~+50°
	const GRAVITY = 10;
	const WATER_TANK_DRAG = 0.85; // extra drag when wading — caps top speed to ~25% of normal
	const MOUSE_TURRET_SENS = 0.003; // rad per pixel
	const MOUSE_BARREL_SENS = 0.002;
	const SHELL_MIN_SPEED = 25;
	const SHELL_MAX_SPEED = 70;

	const WAX_WAKE_SPACING = 4; // world units traveled between wake emissions
	const MIN_WAKE_SPEED = 0.3; // minimum tank speed to emit wakes

	const CAMERA_HEIGHT = 4;
	const CAMERA_BEHIND = 10;
	const CHASE_LERP = 3;
	const NORMAL_FOV = 50;
	const ZOOM_FOV = 10;
	const ZOOM_FOV_LERP = 8;
	const ZOOM_AIM_FACTOR = 0.2;

	const TANK_RADIUS = 1.4; // collision radius for trunk hit detection
	const COLLISION_RESTITUTION = 0.3; // 0 = perfectly plastic, 1 = perfectly elastic
	const PUSH_DECAY = 0.1; // fraction of push velocity remaining after 1 second

	// Track contact corners in local space: (±TRACK_W, 0, ±TRACK_L)
	const TRACK_W = 1.1;
	const TRACK_L = 1.6;

	// Track belt visual constants
	const trackSides = [-1.1, 1.1];
	const roadWheelZ = [-1.0, -0.5, 0, 0.5, 1.0];
	const TRACK_LENGTH = 3.2;
	const GROUSER_COUNT = 16;
	const GROUSER_SPACING = TRACK_LENGTH / GROUSER_COUNT;
	const TRACK_WHEEL_RADIUS = 0.17;
	const grouserIndices = Array.from({ length: GROUSER_COUNT }, (_, i) => i);

	// --- State ---
	let tankPosition = $state(new THREE.Vector3(0, 0, 0));
	let speed = $state(0);
	let tankHeading = $state(0);
	let tankPitch = $state(0);
	let tankRoll = $state(0);
	let velocityY = $state(0);
	let wheelSpinLeft = $state(0);
	let wheelSpinRight = $state(0);
	let turretHeading = $state(0);
	let barrelElevation = $state(0);

	let cameraPosition = $state(new THREE.Vector3(0, CAMERA_HEIGHT, CAMERA_BEHIND));
	let cameraRef: Object3D | null = null;
	let lightRef: THREE.DirectionalLight | null = null;
	let zoomed = $state(false);
	let currentFov = NORMAL_FOV;
	let zoomedAtFireTime = false; // was zoom already on when the last shot was fired?

	let wakes = $state<{ id: number; x: number; z: number }[]>([]);
	let nextWakeId = 0;
	let wakeTimer = 0;

	const GAME_OVER_LIFT_DURATION = 30; // seconds to reach overview height
	// At H=800, vertical visible span ≈ 746 units (FOV 50°) — covers the 750-unit terrain
	// without showing the water margin on the shorter (vertical) screen dimension.
	const OVERVIEW_HEIGHT = 800;
	let gameOverCamElapsed = 0;
	let gameOverCamStartPos: THREE.Vector3 | null = null;
	let gameOverCamStartQuat: THREE.Quaternion | null = null;

	const LIGHT_OFFSET = new THREE.Vector3(-50, 50, 30);
	const SHADOW_HALF = 50;

	// --- Health and fire system ---
	const TANK_MAX_HEALTH = 100;
	const CENTER_HIT_DAMAGE = 50; // HP lost for a dead-centre hit (2 hits = death)
	const EDGE_HIT_DAMAGE = 15; // HP lost for a glancing hit at max radius
	const CENTER_BURN_DURATION = 3; // seconds of fire for a centre hit
	const EDGE_BURN_DURATION = 0.7; // seconds of fire for an edge hit
	const HIT_RADIUS = 2.5; // must match Shell.svelte
	const SPLASH_DAMAGE = 8; // HP from nearby explosion — one flame, brief burn
	const SPLASH_BURN_DURATION = 0.4;
	let health = $state(TANK_MAX_HEALTH);
	let burning = $state(false);
	let tankDestroyed = $state(false);
	let burnElapsed = 0;
	let burnDuration = 0;
	let burnDamageRate = 0;
	let hitOffsetX = $state(0); // world-space XZ offset from tank centre to hit point (clamped)
	let hitOffsetZ = $state(0);
	let flameCount = $state(6); // number of flame cones visible — scales with hit proximity
	let tankGroupRef: THREE.Group | null = null;
	// Explicit change tracking for onhealthchange — avoids $effect and its reactive dependency on the prop
	let _lastReportedHealth = -1;
	let _lastReportedDestroyed = false;
	let _lastDamageUpdate = -1;

	// Reusable scratch objects to avoid per-frame allocations in useTask and fire()
	const _X_AXIS = new THREE.Vector3(1, 0, 0);
	const _Y_AXIS = new THREE.Vector3(0, 1, 0);
	const _scratchVec3 = new THREE.Vector3();
	const _scratchEuler = new THREE.Euler(0, 0, 0, 'XYZ');
	const _scratchQuat = new THREE.Quaternion();
	// Mantlet pivot offset in turret-local space — read-only, shared across fire() and aiFire()
	const _PIVOT_OFFSET = new THREE.Vector3(0, 1.29, -0.67);
	// Target camera orientation for game-over overview: looking straight down, east (+X) pointing up-screen.
	// Computed once via a dummy camera to avoid manual quaternion math.
	const _GAME_OVER_END_QUAT = (() => {
		const dummy = new THREE.PerspectiveCamera();
		dummy.up.set(1, 0, 0);
		dummy.position.set(0, 1, 0);
		dummy.lookAt(0, 0, 0);
		return dummy.quaternion.clone();
	})();

	// Custom hull geometry: trapezoidal prism, bottom wider than top.
	// Front slopes more than back so front/back are visually distinct.
	// All coords in tilt-group local space (y=0.30 = track top, y=1.10 = hull top).
	function makeHullGeometry(): THREE.BufferGeometry {
		const TY = 1.1,
			BY = 0.3; // top / bottom Y
		const TZF = -1.2,
			TZB = 1.2; // top Z front / back  (length 2.4)
		const BZF = -1.7,
			BZB = 1.35; // bottom Z front / back (front extends 0.5 more, back 0.15)
		const X = 0.9; // half-width (unchanged)

		const pts: [number, number, number][] = [
			[-X, TY, TZF],
			[X, TY, TZF], // 0,1  top-front  L/R
			[X, TY, TZB],
			[-X, TY, TZB], // 2,3  top-back   R/L
			[-X, BY, BZF],
			[X, BY, BZF], // 4,5  bot-front  L/R
			[X, BY, BZB],
			[-X, BY, BZB] // 6,7  bot-back   R/L
		];

		// Each quad listed CCW from outside → 2 triangles (a,b,c) + (a,c,d)
		const quads: [number, number, number, number][] = [
			[0, 3, 2, 1], // top    (+Y)
			[4, 5, 6, 7], // bottom (-Y)
			[0, 1, 5, 4], // front  (sloped, -Z dominant)
			[3, 7, 6, 2], // back   (near-vertical, +Z dominant)
			[0, 4, 7, 3], // left   (-X)
			[1, 2, 6, 5] // right  (+X)
		];

		// UV projection axes per face: [uAxis (0=x,1=y,2=z), vAxis]
		const faceUVAxes: [number, number][] = [
			[0, 2], // top    (+Y): u=x, v=z
			[0, 2], // bottom (-Y): u=x, v=z
			[0, 1], // front  (-Z): u=x, v=y
			[0, 1], // back   (+Z): u=x, v=y
			[2, 1], // left   (-X): u=z, v=y
			[2, 1] //  right  (+X): u=z, v=y
		];

		const pos: number[] = [];
		const uvs: number[] = [];

		for (let qi = 0; qi < quads.length; qi++) {
			const [a, b, c, d] = quads[qi];
			const [uAxis, vAxis] = faceUVAxes[qi];
			const uVals = [a, b, c, d].map((i) => pts[i][uAxis]);
			const vVals = [a, b, c, d].map((i) => pts[i][vAxis]);
			const uMin = Math.min(...uVals),
				uRange = Math.max(...uVals) - uMin || 1;
			const vMin = Math.min(...vVals),
				vRange = Math.max(...vVals) - vMin || 1;
			const uv = (i: number) => [(pts[i][uAxis] - uMin) / uRange, (pts[i][vAxis] - vMin) / vRange];
			for (const i of [a, b, c]) {
				pos.push(...pts[i]);
				uvs.push(...uv(i));
			}
			for (const i of [a, c, d]) {
				pos.push(...pts[i]);
				uvs.push(...uv(i));
			}
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
		geo.computeVertexNormals();
		return geo;
	}

	const hullGeometry = makeHullGeometry();

	// Per-face normal-displacement offsets — each of the 6 hull quads (18 values) gets a stable
	// random push along its face normal so damage looks like crumpled armour plates, not gaps.
	const posAttr = hullGeometry.getAttribute('position') as THREE.Float32BufferAttribute;
	const origPos = new Float32Array(posAttr.array);
	const dentOffsets = (() => {
		const buf = new Float32Array(origPos.length);
		const normAttr = hullGeometry.getAttribute('normal') as THREE.Float32BufferAttribute;
		let s = ownBody.uid >>> 0;
		for (let q = 0; q < 6; q++) {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			const d = s / 0xffffffff - 0.5; // [-0.5, 0.5]
			const base = q * 18;
			const nx = normAttr.array[base] as number;
			const ny = normAttr.array[base + 1] as number;
			const nz = normAttr.array[base + 2] as number;
			for (let v = 0; v < 6; v++) {
				const vi = base + v * 3;
				buf[vi] = nx * d;
				buf[vi + 1] = ny * d;
				buf[vi + 2] = nz * d;
			}
		}
		return buf;
	})();

	const _texLoader = new THREE.TextureLoader();
	function loadTex(prefix: string, suffix: string, srgb = false): THREE.Texture {
		const tex = _texLoader.load(`/textures/${prefix}_1K-JPG_${suffix}.jpg`);
		if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
		return tex;
	}
	const _metalColor = loadTex('Metal047B', 'Color', true);
	const _metalNormal = loadTex('Metal047B', 'NormalGL');
	const _metalRoughness = loadTex('Metal047B', 'Roughness');
	const _metalMetalness = loadTex('Metal047B', 'Metalness');

	const hullMaterial = new THREE.MeshStandardMaterial({
		color: tankColor,
		map: _metalColor,
		normalMap: _metalNormal,
		roughnessMap: _metalRoughness,
		metalnessMap: _metalMetalness,
		metalness: 1.0,
		roughness: 1.0,
		side: THREE.DoubleSide
	});
	const turretMaterial = hullMaterial;

	const barrelMaterial = new THREE.MeshStandardMaterial({
		map: loadTex('Metal055A', 'Color', true),
		normalMap: loadTex('Metal055A', 'NormalGL'),
		roughnessMap: loadTex('Metal055A', 'Roughness'),
		metalnessMap: loadTex('Metal055A', 'Metalness'),
		metalness: 1.0,
		roughness: 1.0
	});

	onDestroy(() => {
		if (engineSound?.isPlaying) engineSound.stop();
		if (shotSound?.isPlaying) shotSound.stop();
		const idx = tankBodies?.indexOf(ownBody) ?? -1;
		if (idx !== -1) tankBodies!.splice(idx, 1);
		hullGeometry.dispose();
		hullMaterial.map?.dispose();
		hullMaterial.normalMap?.dispose();
		hullMaterial.roughnessMap?.dispose();
		hullMaterial.metalnessMap?.dispose();
		hullMaterial.dispose();
		barrelMaterial.map?.dispose();
		barrelMaterial.normalMap?.dispose();
		barrelMaterial.roughnessMap?.dispose();
		barrelMaterial.metalnessMap?.dispose();
		barrelMaterial.dispose();
	});

	const handleLightCreate = (ref: THREE.DirectionalLight) => {
		lightRef = ref;
		ref.shadow.camera.left = -SHADOW_HALF;
		ref.shadow.camera.right = SHADOW_HALF;
		ref.shadow.camera.top = SHADOW_HALF;
		ref.shadow.camera.bottom = -SHADOW_HALF;
		ref.shadow.camera.near = 0.5;
		ref.shadow.camera.far = 200;
		ref.shadow.mapSize.set(4096, 4096);
		ref.shadow.camera.updateProjectionMatrix();
	};

	// --- Keyboard input ---
	let upHeld = false,
		downHeld = false,
		leftHeld = false,
		rightHeld = false;
	let turretLeftHeld = false,
		turretRightHeld = false;
	let barrelUpHeld = false,
		barrelDownHeld = false;
	let braking = false;
	let mouseDX = 0,
		mouseDY = 0;

	// --- AI constants (non-controlled tanks only) ---
	const AI_VISION_RANGE = 400;
	const AI_MIN_ENGAGE_DIST = 25; // back away if closer than this
	const AI_MAX_ENGAGE_DIST = 350; // approach if farther than this
	const AI_AIM_TOL = 0.05; // radians within aim target before firing
	const AI_STOP_SPEED = 0.6; // must be slower than this to fire
	const AI_MAX_FIRE_SLOPE = 0.15; // max combined pitch+roll (rad) before seeking flatter ground
	const AI_SLOPE_CREEP_SPEED = 3; // m/s crawl speed while seeking flat ground inside engagement range
	const AI_SEARCH_APPROACH_DIST = AI_MIN_ENGAGE_DIST * 2; // switch to half-speed within this radius of last known position
	const AI_SEARCH_APPROACH_SPEED = 8; // m/s cap during slow approach (≈ half of ~16.7 m/s terminal velocity)
	const AI_SEARCH_ARRIVE_DIST = 12; // give up and patrol when this close to last known position
	const CUPOLA_H = 1.6; // cupola-top Y above tankPosition.y for LOS origin/target
	const AI_REPOSITION_MISSES = 3; // consecutive misses before closing or opening the engagement range
	const AI_STUCK_TIMEOUT = 1.5; // seconds of blocked movement before attempting a terrain detour

	// AI state — plain lets, reset automatically on component remount (restart)
	let aiState: 'patrol' | 'search' | 'engage' | 'cooldown' = 'patrol';
	let aiTargetUid: number | null = null;
	let aiLastSeenX = 0;
	let aiLastSeenZ = 0;
	let aiLastSeenTime = 0;
	let aiPatrolAngle = spawnHeading;
	let aiPatrolTimer = 2 + Math.random() * 4;
	let aiScanDir = Math.random() < 0.5 ? 1 : -1;
	let aiCooldownTimer = 0;
	let aiTargetTurretH = 0;
	let aiTargetElev = 0;
	let aiFireSpeed = SHELL_MIN_SPEED;
	let aiStopTimer = 0;
	let aiAimBiasSpeed = 0; // speed offset re-rolled after each shot to bracket the range
	let aiAimBiasTurret = 0; // turret offset re-rolled after each shot to bracket the angle
	let aiTargetVelX = 0; // estimated target X velocity (world units/s)
	let aiTargetVelZ = 0;
	let aiVelSampleX = 0; // target position at last velocity sample
	let aiVelSampleZ = 0;
	let aiVelSampleTime = 0; // Date.now() timestamp of last velocity sample
	let aiMissCount = 0; // consecutive misses — triggers repositioning when high
	let aiStuckTimer = 0; // seconds the AI has been trying to move with speed near 0
	let aiStuckTurnDir = 1; // +1 = detour left, -1 = detour right

	$effect(() => {
		if (!controlled) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.code === 'KeyW') upHeld = true;
			if (e.code === 'KeyS') downHeld = true;
			if (e.code === 'KeyA') leftHeld = true;
			if (e.code === 'KeyD') rightHeld = true;
			if (e.code === 'ArrowLeft') turretLeftHeld = true;
			if (e.code === 'ArrowRight') turretRightHeld = true;
			if (e.code === 'ArrowUp') barrelUpHeld = true;
			if (e.code === 'ArrowDown') barrelDownHeld = true;
			if (e.code === 'KeyX') braking = true;
			if (e.code === 'KeyZ') zoomed = !zoomed;
		};
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.code === 'KeyW') upHeld = false;
			if (e.code === 'KeyS') downHeld = false;
			if (e.code === 'KeyA') leftHeld = false;
			if (e.code === 'KeyD') rightHeld = false;
			if (e.code === 'ArrowLeft') turretLeftHeld = false;
			if (e.code === 'ArrowRight') turretRightHeld = false;
			if (e.code === 'ArrowUp') barrelUpHeld = false;
			if (e.code === 'ArrowDown') barrelDownHeld = false;
		};
		const onMouseMove = (e: MouseEvent) => {
			if (document.pointerLockElement !== null) {
				mouseDX += e.movementX;
				mouseDY += e.movementY;
			}
		};
		const onTankFire = (e: Event) => {
			fire((e as CustomEvent<{ chargeLevel: number }>).detail.chargeLevel);
		};
		const onShellSequenceDone = () => {
			if (!zoomedAtFireTime) zoomed = false;
		};
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('mousemove', onMouseMove);
		window.addEventListener('tank-fire', onTankFire);
		window.addEventListener('shell-sequence-done', onShellSequenceDone);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('tank-fire', onTankFire);
			window.removeEventListener('shell-sequence-done', onShellSequenceDone);
		};
	});

	function fire(chargeLevel: number) {
		zoomedAtFireTime = zoomed;
		_scratchEuler.set(tankPitch, 0, tankRoll, 'XYZ');
		// Muzzle world position: tip of barrel at z=-2.25 in elevation-group local space
		const muzzle = _scratchVec3.set(0, 0, -2.25)
			.applyAxisAngle(_X_AXIS, barrelElevation)
			.add(_PIVOT_OFFSET)
			.applyAxisAngle(_Y_AXIS, turretHeading)
			.applyEuler(_scratchEuler)
			.applyAxisAngle(_Y_AXIS, tankHeading)
			.add(tankPosition)
			.clone();

		// Firing direction — barrel points in local -Z
		const dir = new THREE.Vector3(0, 0, -1);
		dir.applyAxisAngle(_X_AXIS, barrelElevation);
		dir.applyAxisAngle(_Y_AXIS, turretHeading);
		dir.applyEuler(_scratchEuler);
		dir.applyAxisAngle(_Y_AXIS, tankHeading);
		dir.multiplyScalar(SHELL_MIN_SPEED + chargeLevel * (SHELL_MAX_SPEED - SHELL_MIN_SPEED));

		onfire?.(muzzle, dir, ownBody.uid);
		if (shotSound && audioBuffers?.shot) {
			if (!shotSound.buffer) shotSound.setBuffer(audioBuffers.shot);
			if (shotSound.isPlaying) shotSound.stop();
			shotSound.play();
		}
	}

	// --- AI helpers ---
	function normalizeAngle(a: number): number {
		if (a > Math.PI) a -= 2 * Math.PI;
		if (a < -Math.PI) a += 2 * Math.PI;
		return a;
	}

	// Terrain line-of-sight: cupola top → target cupola top.
	// Steps scaled to distance so the gap between samples never exceeds one terrain cell (5 u),
	// preventing a narrow hilltop from slipping between two checks at long range.
	function aiLosCheck(tx: number, ty: number, tz: number): boolean {
		const sx = tankPosition.x,
			sy = tankPosition.y + CUPOLA_H,
			sz = tankPosition.z;
		const dx = tx - sx,
			dz = tz - sz;
		const ey = ty + CUPOLA_H;
		const steps = Math.max(16, Math.ceil(Math.sqrt(dx * dx + dz * dz) / 5));
		for (let i = 1; i < steps; i++) {
			const t = i / steps;
			if (getTerrainHeight(sx + dx * t, sz + dz * t) > sy + (ey - sy) * t) return false;
		}
		return true;
	}

	// Within 60° (half-angle) of barrel world azimuth
	function aiFovCheck(tx: number, tz: number): boolean {
		const dx = tx - tankPosition.x,
			dz = tz - tankPosition.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < 0.01) return true;
		const dist = Math.sqrt(d2);
		const az = tankHeading + turretHeading;
		return (dx / dist) * -Math.sin(az) + (dz / dist) * -Math.cos(az) > 0.5; // cos(60°)
	}

	function aiCanSeeBody(body: TankBody): boolean {
		if (body.hitAt !== null) return false;
		const dx = body.x - tankPosition.x,
			dz = body.z - tankPosition.z;
		if (dx * dx + dz * dz > AI_VISION_RANGE * AI_VISION_RANGE) return false;
		return aiFovCheck(body.x, body.z) && aiLosCheck(body.x, body.y, body.z);
	}

	// Ballistic solver: compute turret yaw + barrel elevation + speed to hit (tx, ty, tz).
	// Prefers the low-angle (flatter) solution. Returns false if target unreachable.
	function aiComputeAim(tx: number, ty: number, tz: number): boolean {
		const dx = tx - tankPosition.x,
			dz = tz - tankPosition.z;
		const horizDist = Math.sqrt(dx * dx + dz * dz);
		if (horizDist < 1) return false;
		aiTargetTurretH = normalizeAngle(Math.atan2(-dx, -dz) - tankHeading);
		const deltaH = ty + CUPOLA_H * 0.5 - (tankPosition.y + 1.29); // aim at mid-cupola
		for (let v = SHELL_MIN_SPEED; v <= SHELL_MAX_SPEED; v += 3) {
			const v2 = v * v;
			const disc = v2 * v2 - GRAVITY * (GRAVITY * horizDist * horizDist + 2 * deltaH * v2);
			if (disc < 0) continue;
			const sqD = Math.sqrt(disc);
			// Low angle first, then high angle if low is out of limits
			for (const u of [(v2 - sqD) / (GRAVITY * horizDist), (v2 + sqD) / (GRAVITY * horizDist)]) {
				const e = Math.atan(u);
				if (e >= BARREL_MIN && e <= BARREL_MAX) {
					aiTargetElev = e;
					aiFireSpeed = v;
					return true;
				}
			}
		}
		return false;
	}

	// Fire a shell using the current barrel aim — mirrors fire() but uses aiFireSpeed
	function aiFire() {
		_scratchEuler.set(tankPitch, 0, tankRoll, 'XYZ');
		const muzzle = _scratchVec3.set(0, 0, -2.25)
			.applyAxisAngle(_X_AXIS, barrelElevation)
			.add(_PIVOT_OFFSET)
			.applyAxisAngle(_Y_AXIS, turretHeading)
			.applyEuler(_scratchEuler)
			.applyAxisAngle(_Y_AXIS, tankHeading)
			.add(tankPosition)
			.clone();
		const dir = new THREE.Vector3(0, 0, -1);
		dir.applyAxisAngle(_X_AXIS, barrelElevation);
		dir.applyAxisAngle(_Y_AXIS, turretHeading);
		dir.applyEuler(_scratchEuler);
		dir.applyAxisAngle(_Y_AXIS, tankHeading);
		dir.multiplyScalar(aiFireSpeed);
		onfire?.(muzzle, dir, ownBody.uid);
		if (shotSound && audioBuffers?.shot) {
			if (!shotSound.buffer) shotSound.setBuffer(audioBuffers.shot);
			if (shotSound.isPlaying) shotSound.stop();
			shotSound.play();
		}
	}

	// --- Terrain helpers ---
	function getTrackHeight(cx: number, cz: number, heading: number): number {
		const cosH = Math.cos(heading),
			sinH = Math.sin(heading);
		const sinPitch = Math.sin(tankPitch),
			sinRoll = Math.sin(tankRoll);
		let maxY = -Infinity;
		for (const lx of [-TRACK_W, TRACK_W]) {
			for (const lz of [-TRACK_L, TRACK_L]) {
				const wx = cx + lx * cosH + lz * sinH;
				const wz = cz - lx * sinH + lz * cosH;
				// Required tank-centre Y so this corner doesn't penetrate the terrain,
				// accounting for the tilt the corner already contributes in world space.
				const requiredY = getTerrainHeight(wx, wz) + lz * sinPitch - lx * sinRoll;
				if (requiredY > maxY) maxY = requiredY;
			}
		}
		return maxY;
	}

	function snapTankToTerrain(x: number, z: number) {
		tankPosition = new THREE.Vector3(x, getTrackHeight(x, z, tankHeading), z);
		velocityY = 0;
	}

	function resetCamera() {
		const camX = tankPosition.x + Math.sin(tankHeading) * CAMERA_BEHIND;
		const camZ = tankPosition.z + Math.cos(tankHeading) * CAMERA_BEHIND;
		const camY = Math.max(
			tankPosition.y + CAMERA_HEIGHT,
			getTerrainHeight(camX, camZ) + CAMERA_HEIGHT
		);
		cameraPosition = new THREE.Vector3(camX, camY, camZ);
	}

	export function reset(sx = 0, sz = 0, sh = 0) {
		health = TANK_MAX_HEALTH;
		burning = false;
		burnElapsed = 0;
		tankDestroyed = false;
		ownBody.hitAt = null;
		ownBody.lastHit = null;
		hitOffsetX = 0;
		hitOffsetZ = 0;
		flameCount = 6;
		_lastDamageUpdate = -1;
		(posAttr.array as Float32Array).set(origPos);
		posAttr.needsUpdate = true;
		hullGeometry.computeVertexNormals();
		speed = 0;
		velocityY = 0;
		tankHeading = sh;
		tankPitch = 0;
		tankRoll = 0;
		wheelSpinLeft = 0;
		wheelSpinRight = 0;
		turretHeading = 0;
		barrelElevation = 0;
		braking = false;
		wakes = [];
		wakeTimer = 0;
		snapTankToTerrain(sx, sz);
		resetCamera();
	}

	// Snap to terrain on first mount (initGame runs before Tank mounts, so heights are ready)
	onMount(() => {
		tankHeading = spawnHeading;
		snapTankToTerrain(spawnX, spawnZ);
		resetCamera();
	});

	// --- Per-frame loop ---
	useTask((delta) => {
		// Report health changes — called from useTask (outside Svelte reactivity) to avoid cycles
		if (health !== _lastReportedHealth || tankDestroyed !== _lastReportedDestroyed) {
			_lastReportedHealth = health;
			_lastReportedDestroyed = tankDestroyed;
			onhealthchange?.(health, tankDestroyed);
		}

		// Visual damage — panel removal and hull dents accumulate with health loss.
		// Hull position buffer layout (non-indexed, 6 quads × 6 verts × 3 floats):
		//   quad 0 top [0..17], quad 1 bottom [18..35], quad 2 front [36..53],
		//   quad 3 back [54..71], quad 4 left [72..89], quad 5 right [90..107]
		// Back bottom Y: indices 58, 61, 67. Back bottom Z: 59, 62, 68.
		// Front bottom Y: indices 43, 49, 52. Front bottom Z: 44, 50, 53.
		{
			const damageFraction = 1 - health / TANK_MAX_HEALTH;
			if (Math.abs(damageFraction - _lastDamageUpdate) > 0.005) {
				_lastDamageUpdate = damageFraction;
				const posData = posAttr.array as Float32Array;
				posData.set(origPos);
				// Back plate: bottom edge sweeps from BY=0.3 to TY=1.1 as damage goes 25%→75%
				const backT = Math.max(0, Math.min(0.99, (damageFraction - 0.25) / 0.5));
				if (backT > 0) {
					const bY = 0.3 + backT * 0.8;
					const bZ = 1.35 - backT * 0.15;
					posData[58] = bY;
					posData[59] = bZ;
					posData[61] = bY;
					posData[62] = bZ;
					posData[67] = bY;
					posData[68] = bZ;
				}
				// Front plate: same sweep as damage goes 45%→95%
				const frontT = Math.max(0, Math.min(0.99, (damageFraction - 0.45) / 0.5));
				if (frontT > 0) {
					const fY = 0.3 + frontT * 0.8;
					const fZ = -1.7 + frontT * 0.5;
					posData[43] = fY;
					posData[44] = fZ;
					posData[49] = fY;
					posData[50] = fZ;
					posData[52] = fY;
					posData[53] = fZ;
				}
				// Per-face normal dents compound with the panel deformation
				const dentScale = Math.pow(Math.max(0, (damageFraction - 0.15) / 0.85), 0.8) * 0.15;
				if (dentScale > 0) {
					for (let i = 0; i < posData.length; i++) posData[i] += dentOffsets[i] * dentScale;
				}
				posAttr.needsUpdate = true;
				if (backT > 0 || frontT > 0) hullGeometry.computeVertexNormals();
			}
		}

		// Game-over camera — lifts to overview, runs even when this tank is destroyed.
		// Uses quaternion SLERP so orientation rotates smoothly from tank-following to top-down
		// rather than staying locked to the tank heading and snapping at the end.
		if (chaseCamera && gameOver) {
			if (gameOverCamStartPos === null) {
				gameOverCamStartPos = cameraPosition.clone();
				gameOverCamStartQuat =
					(cameraRef as THREE.PerspectiveCamera | null)?.quaternion.clone() ?? null;
			}
			gameOverCamElapsed += delta;
			const t = Math.min(1, gameOverCamElapsed / GAME_OVER_LIFT_DURATION);
			const eased = 1 - Math.pow(1 - t, 2);
			// Orientation reaches top-down within 5 s; position lifts over the full 30 s
			const tRot = Math.min(1, gameOverCamElapsed / 5);
			const easedRot = 1 - Math.pow(1 - tRot, 2);
			cameraPosition = new THREE.Vector3(
				gameOverCamStartPos.x * (1 - eased),
				gameOverCamStartPos.y + (OVERVIEW_HEIGHT - gameOverCamStartPos.y) * eased,
				gameOverCamStartPos.z * (1 - eased)
			);
			if (cameraRef && gameOverCamStartQuat) {
				_scratchQuat.slerpQuaternions(gameOverCamStartQuat, _GAME_OVER_END_QUAT, easedRot);
				(cameraRef as THREE.PerspectiveCamera).quaternion.copy(_scratchQuat);
			}
			currentFov += (NORMAL_FOV - currentFov) * Math.min(1, ZOOM_FOV_LERP * delta);
			if (cameraRef) {
				(cameraRef as THREE.PerspectiveCamera).fov = currentFov;
				(cameraRef as THREE.PerspectiveCamera).updateProjectionMatrix();
			}
		}

		// Engine sound — start when buffer loads; adjust pitch to speed; stop on destruction
		if (engineSound && audioBuffers) {
			if (!engineSound.buffer && audioBuffers.engine) {
				engineSound.setBuffer(audioBuffers.engine);
				engineSound.play();
			}
			if (engineSound.isPlaying) {
				engineSound.setPlaybackRate(0.5 + Math.abs(speed) * 0.04);
				if (tankDestroyed) engineSound.stop();
			}
		}

		// Fully destroyed — nothing to do
		if (tankDestroyed) return;

		// Incoming hit — compute damage and start fire at impact location
		if (ownBody.lastHit !== null) {
			const { dist, wx, wz, splash } = ownBody.lastHit;
			ownBody.lastHit = null;
			// Splash: nearby explosion caused a brief 1-flame fire — don't interrupt a worse ongoing burn
			if (splash) {
				if (!burning) {
					burnDuration = SPLASH_BURN_DURATION;
					burnDamageRate = SPLASH_DAMAGE / SPLASH_BURN_DURATION;
					hitOffsetX = Math.max(-1.5, Math.min(1.5, wx - tankPosition.x));
					hitOffsetZ = Math.max(-1.5, Math.min(1.5, wz - tankPosition.z));
					flameCount = 1;
					burning = true;
					burnElapsed = 0;
					speed = 0;
					braking = false;
				}
			} else {
				// Direct body hit — 2 flames minimum so edge hits are visually distinct from splash
				const hitFraction = 1 - Math.min(1, dist / HIT_RADIUS);
				burnDuration =
					EDGE_BURN_DURATION + hitFraction * (CENTER_BURN_DURATION - EDGE_BURN_DURATION);
				const totalDamage = EDGE_HIT_DAMAGE + hitFraction * (CENTER_HIT_DAMAGE - EDGE_HIT_DAMAGE);
				burnDamageRate = totalDamage / burnDuration;
				hitOffsetX = Math.max(-1.5, Math.min(1.5, wx - tankPosition.x));
				hitOffsetZ = Math.max(-1.5, Math.min(1.5, wz - tankPosition.z));
				flameCount = Math.max(2, Math.round(hitFraction * 6));
				burning = true;
				burnElapsed = 0;
				speed = 0;
				braking = false;
			}
		}

		// Burning state — drain health; explode only if health reaches 0
		if (burning) {
			// Water quenches flames: at full submersion burnElapsed doubles, halving duration and total damage.
			// Hull top is 1.1 units above tankPosition.y; submersion reaches 1 when hull is fully underwater.
			const _inWater = getTerrainHeight(tankPosition.x, tankPosition.z) < 0;
			const _submersion = _inWater ? Math.max(0, Math.min(1, -tankPosition.y / 1.1)) : 0;
			burnElapsed += delta * (1 + _submersion);
			health = Math.max(0, health - burnDamageRate * delta);
			if (health <= 0) {
				health = 0;
				burning = false;
				tankDestroyed = true;
				ownBody.hitAt = Date.now();
				onexplode?.(tankPosition.clone(), tankColor);
				if (tankGroupRef) tankGroupRef.visible = false;
				return;
			}
			if (burnElapsed >= burnDuration) {
				burning = false;
			} else {
				return;
			}
		}

		// AI control — sets input flags each frame; physics reads them immediately after
		if (!controlled) {
			upHeld = false;
			downHeld = false;
			leftHeld = false;
			rightHeld = false;
			turretLeftHeld = false;
			turretRightHeld = false;
			barrelUpHeld = false;
			barrelDownHeld = false;

			if (!gameOver) {
				// Scan for new contacts (FOV + LOS) when not already tracking
				let newContact: TankBody | null = null;
				let newContactDist2 = Infinity;
				if (aiState === 'patrol' || aiState === 'search') {
					for (const body of tankBodies) {
						if (body === ownBody || body.hitAt !== null) continue;
						const bdx = body.x - tankPosition.x,
							bdz = body.z - tankPosition.z;
						const bd2 = bdx * bdx + bdz * bdz;
						if (bd2 < newContactDist2 && aiCanSeeBody(body)) {
							newContact = body;
							newContactDist2 = bd2;
						}
					}
					if (newContact !== null) {
						aiTargetUid = newContact.uid;
						aiLastSeenX = newContact.x;
						aiLastSeenZ = newContact.z;
						aiLastSeenTime = Date.now();
						aiState = 'engage';
						aiStopTimer = 0;
						aiTargetVelX = 0;
						aiTargetVelZ = 0;
						aiVelSampleTime = 0;
						ownBody.lastShellImpact = null;
						aiAimBiasSpeed = 0;
						aiAimBiasTurret = 0;
						aiMissCount = 0;
					}
				}

				// Maintain LOS contact for tracked target (no FOV restriction)
				let engageBody: TankBody | null = null;
				let hasLos = false;
				if (aiState === 'engage' || aiState === 'cooldown') {
					for (const body of tankBodies) {
						if (body.uid === aiTargetUid) {
							engageBody = body;
							break;
						}
					}
					if (engageBody === null || engageBody.hitAt !== null) {
						aiState = 'patrol';
						aiTargetUid = null;
					} else {
						hasLos = aiLosCheck(engageBody.x, engageBody.y, engageBody.z);
						if (hasLos) {
							aiLastSeenX = engageBody.x;
							aiLastSeenZ = engageBody.z;
							aiLastSeenTime = Date.now();
						}
					}
				}

				if (aiState === 'patrol') {
					aiPatrolTimer -= delta;
					if (aiPatrolTimer <= 0) {
						// Bias toward terrain centre so tanks don't get stranded at borders
						const toCenter = Math.atan2(tankPosition.x, tankPosition.z);
						aiPatrolAngle = toCenter + (Math.random() - 0.5) * Math.PI;
						aiPatrolTimer = 6 + Math.random() * 7;
					}
					const hDelta = normalizeAngle(aiPatrolAngle - tankHeading);
					if (hDelta > 0.12) leftHeld = true;
					else if (hDelta < -0.12) rightHeld = true;
					if (Math.abs(hDelta) < 1.2) upHeld = true;
					// Scan turret in ±60° arc
					turretHeading += TURRET_SPEED * 0.45 * aiScanDir * delta;
					if (Math.abs(turretHeading) > Math.PI / 3) {
						aiScanDir = -aiScanDir;
						turretHeading = (Math.PI / 3) * Math.sign(turretHeading);
					}
					barrelElevation += (0.1 - barrelElevation) * Math.min(1, 3 * delta);
				} else if (aiState === 'search') {
					const sdx = aiLastSeenX - tankPosition.x,
						sdz = aiLastSeenZ - tankPosition.z;
					const sDist2 = sdx * sdx + sdz * sdz;
					if (sDist2 < AI_SEARCH_ARRIVE_DIST * AI_SEARCH_ARRIVE_DIST) {
						aiState = 'patrol';
						aiPatrolTimer = 2;
					} else {
						const targetH = Math.atan2(-sdx, -sdz);
						const hDelta = normalizeAngle(targetH - tankHeading);
						if (hDelta > 0.12) leftHeld = true;
						else if (hDelta < -0.12) rightHeld = true;
						if (Math.abs(hDelta) < 1.2) {
							if (sDist2 < AI_SEARCH_APPROACH_DIST * AI_SEARCH_APPROACH_DIST) {
								// Within the slow-approach zone — creep in at half speed
								if (Math.abs(speed) > AI_SEARCH_APPROACH_SPEED) {
									braking = true;
								} else {
									upHeld = true;
								}
							} else {
								upHeld = true;
							}
						}
					}
					turretHeading += TURRET_SPEED * 0.45 * aiScanDir * delta;
					if (Math.abs(turretHeading) > Math.PI / 3) {
						aiScanDir = -aiScanDir;
						turretHeading = (Math.PI / 3) * Math.sign(turretHeading);
					}
				} else if (aiState === 'engage' && engageBody !== null) {
					const aimX = hasLos ? engageBody.x : aiLastSeenX;
					const aimZ = hasLos ? engageBody.z : aiLastSeenZ;
					const aimY = hasLos ? engageBody.y : getTerrainHeight(aiLastSeenX, aiLastSeenZ);
					const edx = aimX - tankPosition.x,
						edz = aimZ - tankPosition.z;
					const eDist = Math.sqrt(edx * edx + edz * edz);

					// After repeated misses, reposition: move closer if shell falls short,
					// back away if shell overshoots. Effect ramps up after AI_REPOSITION_MISSES misses.
					const excessMisses = Math.max(0, aiMissCount - (AI_REPOSITION_MISSES - 1));
					const effectiveMaxDist =
						excessMisses > 0 && aiAimBiasSpeed >= 0
							? Math.max(AI_MIN_ENGAGE_DIST + 50, AI_MAX_ENGAGE_DIST - excessMisses * 50)
							: AI_MAX_ENGAGE_DIST;
					const effectiveMinDist =
						excessMisses > 0 && aiAimBiasSpeed < -3
							? Math.min(AI_MAX_ENGAGE_DIST - 50, AI_MIN_ENGAGE_DIST + excessMisses * 15)
							: AI_MIN_ENGAGE_DIST;

					if (!hasLos && Date.now() - aiLastSeenTime > 2500) {
						aiState = 'search';
					} else if (eDist > effectiveMaxDist) {
						// Approach
						const targetH = Math.atan2(-edx, -edz);
						const hDelta = normalizeAngle(targetH - tankHeading);
						if (hDelta > 0.12) leftHeld = true;
						else if (hDelta < -0.12) rightHeld = true;
						upHeld = true;
					} else {
						// Back-away or good-range: both track the turret and fire.
						const slopeMag = Math.hypot(tankPitch, tankRoll);
						const onSlope = slopeMag > AI_MAX_FIRE_SLOPE;
						const tooClose = eDist < effectiveMinDist;

						if (tooClose) {
							// Too close — back away while keeping the turret on the target.
							// If a hill blocks the direct flee path, redirect 90° sideways to get around it.
							const awayH = Math.atan2(edx, edz);
							const fleeH =
								aiStuckTimer > AI_STUCK_TIMEOUT
									? awayH + aiStuckTurnDir * (Math.PI / 2)
									: awayH;
							const hDelta = normalizeAngle(fleeH - tankHeading);
							if (hDelta > 0.12) leftHeld = true;
							else if (hDelta < -0.12) rightHeld = true;
							upHeld = true;
							// Always track turret geometrically toward the target during escape,
							// regardless of whether the ballistic solver succeeds.
							// This runs before the canHit block so the turret is never left
							// pointing wherever the cooldown happened to leave it.
							const escapeTurretH = normalizeAngle(Math.atan2(-edx, -edz) - tankHeading);
							const escapeTDelta = normalizeAngle(escapeTurretH - turretHeading);
							turretHeading +=
								Math.sign(escapeTDelta) *
								Math.min(Math.abs(escapeTDelta), TURRET_SPEED * delta);
						} else {
							// Good range — find flat ground, then stop and fire.
							// On a sloped platform the barrel's world-space elevation differs from
							// barrelElevation by up to tankPitch/tankRoll, throwing off the ballistic
							// solution. Creep along the terrain contour until the ground is level enough.
							if (onSlope) {
								// Drive along the terrain contour (perpendicular to steepest-ascent
								// direction) so the AI traverses the slope rather than climbing it.
								// Contour direction = gradient rotated 90°; pick the sign that faces
								// roughly toward the target so the AI doesn't wander away.
								const sf = Math.tan(tankPitch),
									sr = Math.tan(tankRoll);
								const sinH = Math.sin(tankHeading),
									cosH = Math.cos(tankHeading);
								// Gradient in world XZ: gx = -sf*sinH + sr*cosH, gz = -sf*cosH - sr*sinH
								// Contour = rotate gradient 90° CCW (viewed top-down): (-gz, gx)
								const c1x = sf * cosH + sr * sinH;
								const c1z = -sf * sinH + sr * cosH;
								const towardTarget = c1x * edx + c1z * edz;
								const cx = towardTarget >= 0 ? c1x : -c1x;
								const cz = towardTarget >= 0 ? c1z : -c1z;
								const contourH = Math.atan2(-cx, -cz);
								const hDelta = normalizeAngle(contourH - tankHeading);
								if (hDelta > 0.12) leftHeld = true;
								else if (hDelta < -0.12) rightHeld = true;
								// Creep slowly so the tank can stop on the first flat patch it finds
								if (Math.abs(speed) > AI_SLOPE_CREEP_SPEED) {
									braking = true;
								} else {
									upHeld = true;
								}
							} else {
								braking = true;
							}
						}

						// Aim and fire — runs for both back-away and good-range.
						// Sample target velocity every 500 ms while we have LOS.
						if (hasLos) {
							const nowMs = Date.now();
							if (aiVelSampleTime > 0 && nowMs - aiVelSampleTime >= 500) {
								const dt = (nowMs - aiVelSampleTime) / 1000;
								aiTargetVelX = (engageBody.x - aiVelSampleX) / dt;
								aiTargetVelZ = (engageBody.z - aiVelSampleZ) / dt;
							}
							if (nowMs - aiVelSampleTime >= 500) {
								aiVelSampleX = engageBody.x;
								aiVelSampleZ = engageBody.z;
								aiVelSampleTime = nowMs;
							}
						}
						// Two-pass aim: first pass gives approximate speed and elevation,
						// second pass leads the target by the estimated flight time.
						let canHit = aiComputeAim(aimX, aimY, aimZ);
						if (canHit && (aiTargetVelX !== 0 || aiTargetVelZ !== 0)) {
							const hd = Math.sqrt(
								(aimX - tankPosition.x) ** 2 + (aimZ - tankPosition.z) ** 2
							);
							const flightTime = hd / Math.max(1, aiFireSpeed * Math.cos(aiTargetElev));
							const ledCanHit = aiComputeAim(
								aimX + aiTargetVelX * flightTime,
								aimY,
								aimZ + aiTargetVelZ * flightTime
							);
							if (!ledCanHit) aiComputeAim(aimX, aimY, aimZ); // restore unled solution
						}
						// Add per-shot correction bias on top of the computed aim
						if (canHit) {
							aiFireSpeed = Math.max(
								SHELL_MIN_SPEED,
								Math.min(SHELL_MAX_SPEED, aiFireSpeed + aiAimBiasSpeed)
							);
							aiTargetTurretH += aiAimBiasTurret;
						}
						if (canHit) {
							const tDelta = normalizeAngle(aiTargetTurretH - turretHeading);
							turretHeading +=
								Math.sign(tDelta) * Math.min(Math.abs(tDelta), TURRET_SPEED * delta);
							const bDelta = aiTargetElev - barrelElevation;
							barrelElevation = Math.max(
								BARREL_MIN,
								Math.min(
									BARREL_MAX,
									barrelElevation +
										Math.sign(bDelta) * Math.min(Math.abs(bDelta), BARREL_SPEED * delta)
								)
							);
							const aimed =
								Math.abs(normalizeAngle(aiTargetTurretH - turretHeading)) < AI_AIM_TOL &&
								Math.abs(aiTargetElev - barrelElevation) < AI_AIM_TOL;
							// Close range: fire while moving (no speed or slope gate).
							// Good range: require stopped on flat ground.
							const fireOk = tooClose
								? aimed && hasLos
								: aimed && Math.abs(speed) < AI_STOP_SPEED && hasLos && !onSlope;
							if (fireOk) {
								aiStopTimer += delta;
								if (aiStopTimer > 0.3) {
									ownBody.lastShellImpact = null; // clear before new shell can write
									aiFire();
									aiState = 'cooldown';
									aiCooldownTimer = 2 + Math.random() * 1.5;
									aiStopTimer = 0;
								}
							} else {
								aiStopTimer = 0;
							}
						}
					}
				} else if (aiState === 'cooldown') {
					aiCooldownTimer -= delta;
					// Track turret and barrel toward last known target position during reload.
					// Heading uses pure geometry (never fails); ballistic re-solve also updates
					// barrel elevation so the AI is aimed and ready when cooldown ends.
					const cdx = aiLastSeenX - tankPosition.x,
						cdz = aiLastSeenZ - tankPosition.z;
					if (cdx * cdx + cdz * cdz >= 1) {
						const trackH = normalizeAngle(Math.atan2(-cdx, -cdz) - tankHeading);
						const tDelta = normalizeAngle(trackH - turretHeading);
						turretHeading +=
							Math.sign(tDelta) * Math.min(Math.abs(tDelta), TURRET_SPEED * delta);
						if (
							aiComputeAim(aiLastSeenX, getTerrainHeight(aiLastSeenX, aiLastSeenZ), aiLastSeenZ)
						) {
							const bDelta = aiTargetElev - barrelElevation;
							barrelElevation = Math.max(
								BARREL_MIN,
								Math.min(
									BARREL_MAX,
									barrelElevation +
										Math.sign(bDelta) * Math.min(Math.abs(bDelta), BARREL_SPEED * delta)
								)
							);
						}
					}
					if (aiCooldownTimer <= 0) {
						// Compute directional correction from where the shell actually landed
						if (ownBody.lastShellImpact !== null) {
							const imp = ownBody.lastShellImpact;
							ownBody.lastShellImpact = null;
							const fx = tankPosition.x,
								fz = tankPosition.z;
							const impDx = imp.x - fx,
								impDz = imp.z - fz;
							const tgtDx = aiLastSeenX - fx,
								tgtDz = aiLastSeenZ - fz;
							const tgtDist = Math.sqrt(tgtDx * tgtDx + tgtDz * tgtDz);
							if (tgtDist > 1) {
								// Project impact onto the target direction so angular misses don't
								// corrupt the range correction (Euclidean distance gives wrong sign
								// when the shell lands far to the side of the target).
								const tgtNx = tgtDx / tgtDist,
									tgtNz = tgtDz / tgtDist;
								const impProj = impDx * tgtNx + impDz * tgtNz;
								// Positive rangeFraction: shell fell short → increase speed; negative: overshot
								const rangeFraction = (tgtDist - impProj) / tgtDist;
								aiAimBiasSpeed = Math.max(
									-10,
									Math.min(10, rangeFraction * (SHELL_MAX_SPEED - SHELL_MIN_SPEED) * 0.5)
								);
								// Angular error: rotate aim toward the target azimuth
								const impHeading = Math.atan2(-impDx, -impDz);
								const tgtHeading = Math.atan2(-tgtDx, -tgtDz);
								aiAimBiasTurret = normalizeAngle(tgtHeading - impHeading) * 0.7;
							}
							aiMissCount++;
						} else {
							// Shot hit a tank — aim was good; reset corrections and miss count
							aiAimBiasSpeed = 0;
							aiAimBiasTurret = 0;
							aiMissCount = 0;
						}
						aiState = hasLos ? 'engage' : 'search';
					}
				}
				// Stuck on terrain: wants to move but speed stays near 0 (slope too steep for heading)
				if ((upHeld || downHeld) && Math.abs(speed) < 0.3) {
					aiStuckTimer += delta;
					if (aiStuckTimer > AI_STUCK_TIMEOUT) {
						// Override steering to detour around the obstacle; flip side every 3× timeout
						leftHeld = aiStuckTurnDir > 0;
						rightHeld = aiStuckTurnDir <= 0;
						if (aiStuckTimer > AI_STUCK_TIMEOUT * 3) {
							aiStuckTurnDir = -aiStuckTurnDir;
							aiStuckTimer = 0;
						}
					}
				} else {
					aiStuckTimer = 0;
				}
			}
		}

		// Input — only when grounded
		let angVel = 0;
		if (velocityY === 0) {
			if (upHeld || downHeld) braking = false;
			if (braking) {
				const decel = BRAKE_DECEL * delta;
				if (Math.abs(speed) <= decel) {
					speed = 0;
					braking = false;
				} else {
					speed -= Math.sign(speed) * decel;
				}
			} else if (upHeld) speed += ACCEL * delta;
			else if (downHeld) speed -= ACCEL * delta;
			if (leftHeld) {
				tankHeading += TURN_SPEED * delta;
				angVel = TURN_SPEED;
			}
			if (rightHeld) {
				tankHeading -= TURN_SPEED * delta;
				angVel = -TURN_SPEED;
			}
		}

		// Horizontal movement
		let newX = tankPosition.x;
		let newZ = tankPosition.z;
		if (speed !== 0) {
			newX -= Math.sin(tankHeading) * speed * delta;
			newZ -= Math.cos(tankHeading) * speed * delta;
			speed *= Math.pow(0.996 ** 60, delta); // frame-rate-independent friction
			if (getTerrainHeight(tankPosition.x, tankPosition.z) < 0)
				speed *= Math.pow(WATER_TANK_DRAG, delta);
			if (Math.abs(speed) < 0.01) speed = 0;
		}

		// External push velocity (impulse received from other tanks) — apply then decay
		newX += ownBody.pushVx * delta;
		newZ += ownBody.pushVz * delta;
		ownBody.pushVx *= Math.pow(PUSH_DECAY, delta);
		ownBody.pushVz *= Math.pow(PUSH_DECAY, delta);

		// Terrain slope at proposed position — used for slope limiting and pitch/roll
		const eps = 0.5;
		const dhdx =
			(getTerrainHeight(newX + eps, newZ) - getTerrainHeight(newX - eps, newZ)) / (2 * eps);
		const dhdz =
			(getTerrainHeight(newX, newZ + eps) - getTerrainHeight(newX, newZ - eps)) / (2 * eps);
		const sinH = Math.sin(tankHeading),
			cosH = Math.cos(tankHeading);
		const slopeForward = dhdx * -sinH + dhdz * -cosH;
		const slopeRight = dhdx * cosH + dhdz * -sinH;

		// Slope limits (only when grounded)
		if (velocityY === 0) {
			const MAX_SLOPE = Math.tan((35 * Math.PI) / 180); // tan(35°) ≈ 0.70

			// Uphill > 35° acts like a wall — stop the tank
			if ((speed > 0 && slopeForward > MAX_SLOPE) || (speed < 0 && slopeForward < -MAX_SLOPE)) {
				speed = 0;
				newX = tankPosition.x;
				newZ = tankPosition.z;
			}

			// Downhill > 35° — slide in the steepest descent direction
			const slopeMag = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
			if (slopeMag > MAX_SLOPE) {
				const slideSpeed = (slopeMag - MAX_SLOPE) * 3;
				newX -= (dhdx / slopeMag) * slideSpeed * delta;
				newZ -= (dhdz / slopeMag) * slideSpeed * delta;
			}
		}

		// Tree trunk collisions — push tank out and cancel speed if driving into trunk
		for (const trunk of treeTrunks) {
			const dx = newX - trunk.x;
			const dz = newZ - trunk.z;
			const distSq = dx * dx + dz * dz;
			const minDist = TANK_RADIUS + trunk.r;
			if (distSq < minDist * minDist) {
				const dist = Math.sqrt(distSq) || 0.001;
				const nx = dx / dist;
				const nz = dz / dist;
				newX = trunk.x + nx * minDist;
				newZ = trunk.z + nz * minDist;
				// Cancel speed only when moving into the trunk (velocity dot normal < 0)
				if ((-Math.sin(tankHeading) * nx + -Math.cos(tankHeading) * nz) * speed < 0) speed = 0;
			}
		}

		// Tank-tank collisions — momentum exchange via impulse written to the other body's push buffer.
		// n points from the other tank (B) toward this tank (A).
		// vDotN < 0 means A is moving toward B; we transfer momentum and reduce A's speed.
		if (tankBodies) {
			const minTankDist = TANK_RADIUS * 2;
			const fwdX = -Math.sin(tankHeading);
			const fwdZ = -Math.cos(tankHeading);
			for (const body of tankBodies) {
				if (body === ownBody) continue;
				if (body.hitAt !== null) continue; // skip destroyed tanks
				const dx = newX - body.x;
				const dz = newZ - body.z;
				const distSq = dx * dx + dz * dz;
				if (distSq < minTankDist * minTankDist) {
					const dist = Math.sqrt(distSq) || 0.001;
					const nx = dx / dist; // unit normal B→A
					const nz = dz / dist;
					// Resolve overlap — push A out to the contact boundary
					newX = body.x + nx * minTankDist;
					newZ = body.z + nz * minTankDist;
					// Velocity component of A along normal (negative = A moving toward B)
					const fwdDotN = fwdX * nx + fwdZ * nz;
					const vDotN = speed * fwdDotN;
					if (vDotN < 0) {
						// Impulse magnitude transferred to B (equal-mass collision formula)
						const impulse = ((1 + COLLISION_RESTITUTION) / 2) * -vDotN;
						// Push B in the direction A is moving (−n = toward B from A)
						body.pushVx -= nx * impulse;
						body.pushVz -= nz * impulse;
						// Reduce A's speed by the projected component that was transferred
						speed -= ((1 + COLLISION_RESTITUTION) / 2) * vDotN * fwdDotN;
					}
				}
			}
		}

		// Vertical physics — gravity, clamped at terrain (no bounce)
		velocityY -= GRAVITY * delta;
		const newY = tankPosition.y + velocityY * delta;
		const groundY = getTrackHeight(newX, newZ, tankHeading);
		const grounded = newY <= groundY + 0.1;
		if (grounded) {
			tankPosition = new THREE.Vector3(newX, groundY, newZ);
			velocityY = 0;
		} else {
			tankPosition = new THREE.Vector3(newX, newY, newZ);
		}
		ownBody.x = tankPosition.x;
		ownBody.y = tankPosition.y;
		ownBody.z = tankPosition.z;

		// Pitch and roll (only while grounded, reuse slope computed above)
		if (grounded) {
			const tiltT = Math.min(1, 8 * delta);
			tankPitch += (Math.atan(slopeForward) - tankPitch) * tiltT;
			tankRoll += (Math.atan(slopeRight) - tankRoll) * tiltT;
		}

		// Track wheel animation — differential steering
		// Use max(speed, inputSpin) so wheels match actual movement when coasting, but still
		// spin visibly when slope blocks movement (speed=0 but key held).
		const accelSpin = (upHeld ? 2 : downHeld ? -2 : 0) * ACCEL;
		const spinDir = speed !== 0 ? Math.sign(speed) : Math.sign(accelSpin);
		const spinSpeed =
			spinDir >= 0 ? Math.max(speed * 3, accelSpin) : Math.min(speed * 3, accelSpin);
		wheelSpinLeft += (spinSpeed - angVel * 3) * delta;
		wheelSpinRight += (spinSpeed + angVel * 3) * delta;

		// Turret and barrel
		const aimFactor = zoomed ? ZOOM_AIM_FACTOR : 1;
		// Keyboard aim
		if (turretLeftHeld) turretHeading += TURRET_SPEED * aimFactor * delta;
		if (turretRightHeld) turretHeading -= TURRET_SPEED * aimFactor * delta;
		if (barrelUpHeld)
			barrelElevation = Math.min(BARREL_MAX, barrelElevation + BARREL_SPEED * aimFactor * delta);
		if (barrelDownHeld)
			barrelElevation = Math.max(BARREL_MIN, barrelElevation - BARREL_SPEED * aimFactor * delta);

		// Mouse aim — directly controls turret heading and barrel elevation
		if (mouseDX !== 0 || mouseDY !== 0) {
			turretHeading -= mouseDX * MOUSE_TURRET_SENS * aimFactor;
			barrelElevation = Math.max(
				BARREL_MIN,
				Math.min(BARREL_MAX, barrelElevation + mouseDY * MOUSE_BARREL_SENS * aimFactor)
			);
			mouseDX = 0;
			mouseDY = 0;
		}

		// Camera — follows behind the barrel direction (turret heading relative to hull)
		if (chaseCamera && !gameOver) {
			const t = Math.min(1, CHASE_LERP * delta);
			const absHeading = tankHeading + turretHeading;
			const elevFraction = Math.sin(barrelElevation);
			const targetCamX = tankPosition.x + Math.sin(absHeading) * CAMERA_BEHIND;
			const targetCamZ = tankPosition.z + Math.cos(absHeading) * CAMERA_BEHIND;
			// World-space barrel pitch: project tank tilt onto the barrel's azimuth direction.
			// cos(th)*pitch handles forward/backward facing; sin(th)*roll handles sideways facing.
			const worldBarrelPitch =
				barrelElevation + Math.cos(turretHeading) * tankPitch - Math.sin(turretHeading) * tankRoll;
			const barrelDownLift = Math.max(0, -worldBarrelPitch) * CAMERA_BEHIND * 2;
			const targetCamY = Math.max(
				tankPosition.y + CAMERA_HEIGHT + barrelDownLift,
				getTerrainHeight(targetCamX, targetCamZ) + CAMERA_HEIGHT
			);
			cameraPosition = new THREE.Vector3(
				cameraPosition.x + (targetCamX - cameraPosition.x) * t,
				cameraPosition.y + (targetCamY - cameraPosition.y) * t,
				cameraPosition.z + (targetCamZ - cameraPosition.z) * t
			);
			// While zoomed and a shell is in flight, track the shell; otherwise look at tank
			const shellPos = shellFollow?.pos;
			if (zoomed && shellPos !== null) {
				cameraRef?.lookAt(shellPos.x, shellPos.y, shellPos.z);
			} else {
				cameraRef?.lookAt(
					tankPosition.x,
					tankPosition.y + CAMERA_HEIGHT * 0.5 + elevFraction * CAMERA_BEHIND * 0.4,
					tankPosition.z
				);
			}

			// Zoom — smoothly narrow/widen the FOV
			const targetFov = zoomed ? ZOOM_FOV : NORMAL_FOV;
			currentFov += (targetFov - currentFov) * Math.min(1, ZOOM_FOV_LERP * delta);
			if (cameraRef) {
				(cameraRef as THREE.PerspectiveCamera).fov = currentFov;
				(cameraRef as THREE.PerspectiveCamera).updateProjectionMatrix();
			}

			if (lightRef) {
				lightRef.position.set(
					tankPosition.x + LIGHT_OFFSET.x,
					tankPosition.y + LIGHT_OFFSET.y,
					tankPosition.z + LIGHT_OFFSET.z
				);
				lightRef.target.position.set(tankPosition.x, tankPosition.y, tankPosition.z);
				lightRef.target.updateMatrixWorld();
			}
		}

		// Wake splashes — emitted at front and rear while partially wading through water
		const wading = getTerrainHeight(tankPosition.x, tankPosition.z) < 0 && tankPosition.y > -3.5;
		if (wading && Math.abs(speed) > MIN_WAKE_SPEED) {
			wakeTimer += Math.abs(speed) * delta;
			if (wakeTimer >= WAX_WAKE_SPACING) {
				wakeTimer = 0;
				const sinH = Math.sin(tankHeading);
				const cosH = Math.cos(tankHeading);
				wakes.push({
					id: nextWakeId++,
					x: tankPosition.x - sinH * 1.5,
					z: tankPosition.z - cosH * 1.5
				});
				wakes.push({
					id: nextWakeId++,
					x: tankPosition.x + sinH * 1.2,
					z: tankPosition.z + cosH * 1.2
				});
			}
		} else {
			wakeTimer = 0;
		}
	});

	const handleCameraCreate = (ref: Object3D) => {
		cameraRef = ref;
		ref.lookAt(tankPosition);
		if (controlled && audioListener) ref.add(audioListener);
	};
</script>

{#if chaseCamera}
	<T.PerspectiveCamera
		makeDefault
		castShadow
		position={[cameraPosition.x, cameraPosition.y, cameraPosition.z]}
		oncreate={handleCameraCreate}
	/>
	<T.DirectionalLight castShadow intensity={3} oncreate={handleLightCreate} />
{/if}

<T.Group
	position={[tankPosition.x, tankPosition.y, tankPosition.z]}
	rotation.y={tankHeading}
	oncreate={(ref) => {
		tankGroupRef = ref as THREE.Group;
		if (engineSound) ref.add(engineSound);
		if (shotSound) ref.add(shotSound);
	}}
>
	<T.Group rotation.x={tankPitch} rotation.z={tankRoll}>
		{#each trackSides as tx}
			<!-- Track belt -->
			<T.Mesh position={[tx, 0.15, 0]} castShadow receiveShadow>
				<T.BoxGeometry args={[0.38, 0.3, 3.2]} />
				<T.MeshStandardMaterial color="#1c1c1c" />
			</T.Mesh>

			<!-- Track grouser bars (scrolling links on top and bottom surfaces) -->
			{@const ws = tx < 0 ? wheelSpinLeft : wheelSpinRight}
			{@const scrollOffset =
				(((ws * TRACK_WHEEL_RADIUS) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH}
			{#each grouserIndices as i}
				{@const gz = ((i * GROUSER_SPACING + scrollOffset) % TRACK_LENGTH) - TRACK_LENGTH / 2}
				<!-- Top surface (return run — travels opposite direction) -->
				{@const gz_top =
					((((i * GROUSER_SPACING - scrollOffset) % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH) -
					TRACK_LENGTH / 2}
				<T.Mesh position={[tx, 0.315, gz_top]}>
					<T.BoxGeometry args={[0.42, 0.01, 0.02]} />
					<T.MeshStandardMaterial color="#555" />
				</T.Mesh>
				<!-- Bottom surface (ground contact run) -->
				<T.Mesh position={[tx, -0.015, gz]}>
					<T.BoxGeometry args={[0.42, 0.03, 0.05]} />
					<T.MeshStandardMaterial color="#555" />
				</T.Mesh>
			{/each}

			<!-- Road wheels (5 per side) -->
			{#each roadWheelZ as wz}
				<T.Group position={[tx, 0.15, wz]} rotation.z={Math.PI / 2}>
					<T.Group rotation.y={tx < 0 ? wheelSpinLeft : wheelSpinRight}>
						<T.Mesh castShadow>
							<T.CylinderGeometry args={[0.13, 0.13, 0.48, 10]} />
							<T.MeshStandardMaterial color="#2e2e2e" />
						</T.Mesh>
					</T.Group>
				</T.Group>
			{/each}

			<!-- Front drive sprocket -->
			<T.Group position={[tx, 0.17, -1.6]} rotation.z={Math.PI / 2}>
				<T.Group rotation.y={tx < 0 ? wheelSpinLeft : wheelSpinRight}>
					<T.Mesh castShadow>
						<T.CylinderGeometry args={[0.17, 0.17, 0.48, 16]} />
						<T.MeshStandardMaterial color="#333" />
					</T.Mesh>
					<T.Mesh>
						<T.BoxGeometry args={[0.32, 0.42, 0.14]} />
						<T.MeshStandardMaterial color="#555" />
					</T.Mesh>
					<T.Mesh>
						<T.BoxGeometry args={[0.14, 0.42, 0.32]} />
						<T.MeshStandardMaterial color="#555" />
					</T.Mesh>
				</T.Group>
			</T.Group>

			<!-- Rear idler wheel -->
			<T.Group position={[tx, 0.17, 1.6]} rotation.z={Math.PI / 2}>
				<T.Group rotation.y={tx < 0 ? wheelSpinLeft : wheelSpinRight}>
					<T.Mesh castShadow>
						<T.CylinderGeometry args={[0.17, 0.17, 0.48, 16]} />
						<T.MeshStandardMaterial color="#333" />
					</T.Mesh>
					<T.Mesh>
						<T.BoxGeometry args={[0.32, 0.42, 0.14]} />
						<T.MeshStandardMaterial color="#555" />
					</T.Mesh>
					<T.Mesh>
						<T.BoxGeometry args={[0.14, 0.42, 0.32]} />
						<T.MeshStandardMaterial color="#555" />
					</T.Mesh>
				</T.Group>
			</T.Group>
		{/each}

		<!-- Hull body: trapezoidal prism, front more sloped than back -->
		<T.Mesh castShadow receiveShadow>
			<T is={hullGeometry} attach="geometry" />
			<T is={hullMaterial} attach="material" />
		</T.Mesh>

		<!-- Turret group — rotates independently of hull -->
		<T.Group rotation.y={turretHeading}>
			<!-- Turret — octagonal, slightly tapered -->
			<T.Mesh position={[0, 1.29, -0.15]} rotation.y={Math.PI / 8} castShadow receiveShadow>
				<T.CylinderGeometry args={[0.52, 0.65, 0.38, 16]} />
				<T is={turretMaterial} attach="material" />
			</T.Mesh>

			<!-- Commander's cupola — rotates with turret, not with barrel elevation -->
			<T.Mesh position={[0.2, 1.49, 0.1]} castShadow receiveShadow>
				<T.CylinderGeometry args={[0.17, 0.21, 0.18, 16]} />
				<T is={turretMaterial} attach="material" />
			</T.Mesh>

			<!-- Barrel elevation group — pivots at turret front face (z≈-0.67) -->
			<T.Group position={[0, 1.29, -0.67]} rotation.x={barrelElevation}>
				<!-- Gun mantlet — masks the gap between barrel and turret -->
				<T.Mesh rotation.x={Math.PI / 2} castShadow receiveShadow>
					<T.CylinderGeometry args={[0.22, 0.22, 0.08, 32]} />
					<T is={turretMaterial} attach="material" />
				</T.Mesh>
				<!-- Barrel — offset so muzzle stays at same world position -->
				<T.Mesh position={[0, 0, -0.75]} rotation.x={Math.PI / 2} castShadow>
					<T.CylinderGeometry args={[0.1, 0.1, 3, 16]} />
					<T is={barrelMaterial} attach="material" />
				</T.Mesh>
			</T.Group>
		</T.Group>
	</T.Group>
</T.Group>

{#each wakes as wake (wake.id)}
	<Splash x={wake.x} z={wake.z} onremove={() => (wakes = wakes.filter((w) => w.id !== wake.id))} />
{/each}

<Flames
	x={tankPosition.x + hitOffsetX}
	y={tankPosition.y}
	z={tankPosition.z + hitOffsetZ}
	baseHeight={0.3}
	{burning}
	{flameCount}
/>
