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
