/**
 * Natural-growth leveling on a Fibonacci ladder (1, 2, 3, 5, 8, 13, 21, 34, …).
 *
 * Turns any raw metric into a game-like level with a concrete *next goal* and
 * progress toward it. Levels get harder to reach as you climb — the same way
 * natural growth compounds — because the gap to the next rung keeps widening.
 *
 *   - direction `'up'`   → bigger is better; you climb the ladder.
 *       e.g. €/hour: L1 = 1, L2 = 2, L3 = 3, L4 = 5, L5 = 8 …
 *       e.g. weekly cashflow: …, L11 = 144, L12 = 233, next goal = 377.
 *   - direction `'down'` → smaller is better; you descend it.
 *       e.g. work hours: 89 → 55 → 34 → 21 …, each step down is a level up.
 *       Pass `cap` (your starting / worst value) so level 1 anchors at the top.
 */

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** Fibonacci ladder starting 1, 2 — the level thresholds. */
function buildLadder(maxValue: number): number[] {
	const out = [1, 2]
	while (out[out.length - 1] < maxValue) {
		out.push(out[out.length - 1] + out[out.length - 2])
	}
	return out
}

export const FIB_LADDER: readonly number[] = buildLadder(10_000_000)

/** Index of the smallest rung >= cap (the ceiling). Anchors level 1 for `'down'`. */
function capIndex(fib: readonly number[], cap: number): number {
	for (let k = 0; k < fib.length; k++) if (fib[k] >= cap) return k
	return fib.length - 1
}

export type LevelDirection = 'up' | 'down'

export interface LevelInfo {
	/** 1-based level. `0` means below the first rung (only possible for `'up'`). */
	level: number
	/** Rung value of the current level. */
	current: number
	/** The next goal — cross it to reach the next level. */
	next: number
	/** Progress from the current rung toward `next`, 0…1. */
	progress: number
	direction: LevelDirection
	/** True when there is no higher level left to reach. */
	maxed: boolean
}

export interface LevelOptions {
	direction?: LevelDirection
	/** For `'down'`: the starting / worst value that anchors level 1 (defaults to the ladder top). */
	cap?: number
	/** Override the ladder (defaults to {@link FIB_LADDER}). */
	ladder?: readonly number[]
}

/**
 * Locate `value` on the growth ladder and report its level + next goal.
 */
export function levelFor(value: number, opts: LevelOptions = {}): LevelInfo {
	const direction = opts.direction ?? 'up'
	const fib = opts.ladder ?? FIB_LADDER

	if (direction === 'up') {
		// Highest rung still <= value.
		let i = -1
		for (let k = 0; k < fib.length && fib[k] <= value; k++) i = k
		if (i < 0) {
			const next = fib[0]
			return { level: 0, current: 0, next, progress: clamp01(value / next), direction, maxed: false }
		}
		const maxed = i >= fib.length - 1
		const current = fib[i]
		const next = maxed ? current : fib[i + 1]
		const progress = maxed ? 1 : clamp01((value - current) / (next - current))
		return { level: i + 1, current, next, progress, direction, maxed }
	}

	// direction === 'down' — descend the ladder; smaller is better.
	const cap = opts.cap ?? fib[fib.length - 1]
	const capIdx = capIndex(fib, cap)
	// Smallest rung still >= value (the ceiling you've dropped under).
	let c = capIdx
	for (let k = capIdx; k >= 0; k--) {
		if (fib[k] >= value) c = k
		else break
	}
	const maxed = c <= 0
	const current = fib[c]
	const next = maxed ? fib[0] : fib[c - 1]
	const level = capIdx - c + 1
	const progress = maxed ? 1 : clamp01((current - value) / (current - next))
	return { level, current, next, progress, direction, maxed }
}

export type LevelState = 'cleared' | 'current' | 'next' | 'locked'

export interface LevelCell {
	/** 1-based level number. */
	level: number
	/** Threshold value that unlocks this level. */
	value: number
	state: LevelState
}

function stateFor(level: number, current: number): LevelState {
	if (level < current) return 'cleared'
	if (level === current) return 'current'
	if (level === current + 1) return 'next'
	return 'locked'
}

/**
 * Enumerate the level ladder for a value as display cells (cleared / current /
 * next / locked) — for a gamified progress grid. `lookahead` controls how many
 * locked levels beyond the next goal to include.
 */
export function levelLadder(
	value: number,
	opts: LevelOptions & { lookahead?: number } = {}
): LevelCell[] {
	const direction = opts.direction ?? 'up'
	const fib = opts.ladder ?? FIB_LADDER
	const lookahead = opts.lookahead ?? 4
	const current = levelFor(value, opts).level
	const cells: LevelCell[] = []

	if (direction === 'up') {
		const maxLevel = Math.min(fib.length, Math.max(current + lookahead, 1))
		for (let lv = 1; lv <= maxLevel; lv++) {
			cells.push({ level: lv, value: fib[lv - 1], state: stateFor(lv, current) })
		}
		return cells
	}

	// 'down' — level 1 is the worst (cap), descending toward fib[0]. Stop a few
	// levels past the next goal rather than marching all the way to 1.
	const cap = opts.cap ?? fib[fib.length - 1]
	const capIdx = capIndex(fib, cap)
	const maxLevel = Math.min(capIdx + 1, current + lookahead)
	for (let lv = 1; lv <= maxLevel; lv++) {
		cells.push({ level: lv, value: fib[capIdx - (lv - 1)], state: stateFor(lv, current) })
	}
	return cells
}
