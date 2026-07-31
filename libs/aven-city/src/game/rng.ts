/**
 * Deterministic RNG for procedural generation.
 *
 * Everything visual derives from seeds so a world is fully reproducible:
 * same world seed -> same island, same per-hex seeds -> same trees, forever.
 */

/** mulberry32 — small, fast, good-enough 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Hash two coordinates + seed into a new 32-bit seed (for per-hex RNGs). */
export function hash2(q: number, r: number, seed: number): number {
	let h = seed ^ Math.imul(q, 0x9e3779b1) ^ Math.imul(r, 0x85ebca77)
	h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
	h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
	return (h ^ (h >>> 15)) >>> 0
}

export interface Rng {
	next(): number
	/** uniform in [min, max) */
	range(min: number, max: number): number
	/** integer in [min, max] inclusive */
	int(min: number, max: number): number
	pick<T>(arr: readonly T[]): T
	/** value +- spread (uniform) */
	jitter(value: number, spread: number): number
	chance(p: number): boolean
}

export function makeRng(seed: number): Rng {
	const next = mulberry32(seed)
	return {
		next,
		range: (min, max) => min + next() * (max - min),
		int: (min, max) => min + Math.floor(next() * (max - min + 1)),
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		jitter: (value, spread) => value + (next() * 2 - 1) * spread,
		chance: (p) => next() < p
	}
}
