import type * as THREE from 'three';

export interface TankBody {
	uid: number;
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
