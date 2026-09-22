const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

// Process-local and in-memory on purpose: this exists to protect the DB from
// load, so it can't itself depend on the DB, and adapter-node is a single
// long-lived process (not serverless), so a module-level Map is safe.
const hits = new Map<string, number[]>();

export function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
	recent.push(now);
	hits.set(ip, recent);
	return recent.length > MAX_PER_WINDOW;
}
