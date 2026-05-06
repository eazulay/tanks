<script lang="ts">
	import * as THREE from 'three';
	import { T, useTask } from '@threlte/core';
	import { getContext, onMount, onDestroy } from 'svelte';
	import type { Object3D } from 'three';
	import Splash from './Splash.svelte';

	let {
		controlled = false,
		chaseCamera = false,
		spawnX = 0,
		spawnZ = 0,
		spawnHeading = 0,
		onfire = undefined as ((position: THREE.Vector3, velocity: THREE.Vector3) => void) | undefined
	} = $props();

	const getTerrainHeight: (wx: number, wz: number) => number = getContext('getTerrainHeight');
	const treeTrunks = getContext<{ x: number; z: number; r: number }[]>('treeTrunks');
	const shellFollow = getContext<{ pos: THREE.Vector3 | null }>('shellFollow');

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

	const LIGHT_OFFSET = new THREE.Vector3(-50, 50, 30);
	const SHADOW_HALF = 50;

	// Reusable scratch objects to avoid per-frame allocations in useTask
	const _X_AXIS = new THREE.Vector3(1, 0, 0);
	const _Y_AXIS = new THREE.Vector3(0, 1, 0);
	const _scratchEuler = new THREE.Euler(0, 0, 0, 'XYZ');

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
		color: '#CBFF70', // #556B2F hue normalised so max channel = 1 — tints without darkening
		//color: '#ccffcc',
		map: _metalColor,
		normalMap: _metalNormal,
		roughnessMap: _metalRoughness,
		metalnessMap: _metalMetalness,
		metalness: 1.0,
		roughness: 1.0
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
		// Muzzle world position: tip of barrel at z=-2.25 in elevation-group local space
		const muzzle = new THREE.Vector3(0, 0, -2.25);
		muzzle.applyAxisAngle(_X_AXIS, barrelElevation);
		muzzle.add(new THREE.Vector3(0, 1.29, -0.67));
		muzzle.applyAxisAngle(_Y_AXIS, turretHeading);
		_scratchEuler.set(tankPitch, 0, tankRoll, 'XYZ');
		muzzle.applyEuler(_scratchEuler);
		muzzle.applyAxisAngle(_Y_AXIS, tankHeading);
		muzzle.add(tankPosition);

		// Firing direction — barrel points in local -Z
		const dir = new THREE.Vector3(0, 0, -1);
		dir.applyAxisAngle(_X_AXIS, barrelElevation);
		dir.applyAxisAngle(_Y_AXIS, turretHeading);
		dir.applyEuler(_scratchEuler);
		dir.applyAxisAngle(_Y_AXIS, tankHeading);
		dir.multiplyScalar(SHELL_MIN_SPEED + chargeLevel * (SHELL_MAX_SPEED - SHELL_MIN_SPEED));

		onfire?.(muzzle, dir);
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
		if (chaseCamera) {
			const t = Math.min(1, CHASE_LERP * delta);
			const absHeading = tankHeading + turretHeading;
			const elevFraction = Math.sin(barrelElevation);
			const targetCamX = tankPosition.x + Math.sin(absHeading) * CAMERA_BEHIND;
			const targetCamZ = tankPosition.z + Math.cos(absHeading) * CAMERA_BEHIND;
			const targetCamY = Math.max(
				tankPosition.y + CAMERA_HEIGHT,
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

<T.Group position={[tankPosition.x, tankPosition.y, tankPosition.z]} rotation.y={tankHeading}>
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
