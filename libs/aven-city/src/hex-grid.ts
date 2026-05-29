const SQRT3 = Math.sqrt(3)

export type HexCoord = {
	q: number
	r: number
}

const NEIGHBOR_DIRS: HexCoord[] = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 }
]

export function hexKey(q: number, r: number): string {
	return `${q},${r}`
}

export function parseHexKey(key: string): HexCoord {
	const [q, r] = key.split(',').map(Number)
	return { q, r }
}

/** Flat-top axial layout — matches hexCornerPoints orientation. */
export function axialToWorld(q: number, r: number, radius: number): { x: number; y: number } {
	return {
		x: radius * 1.5 * q,
		y: radius * SQRT3 * (r + q / 2)
	}
}

export function worldToAxial(x: number, y: number, radius: number): HexCoord {
	const q = ((2 / 3) * x) / radius
	const r = ((-1 / 3) * x + (SQRT3 / 3) * y) / radius
	return hexRound(q, r)
}

function hexRound(q: number, r: number): HexCoord {
	const s = -q - r
	let rq = Math.round(q)
	let rr = Math.round(r)
	const rs = Math.round(s)
	const qDiff = Math.abs(rq - q)
	const rDiff = Math.abs(rr - r)
	const sDiff = Math.abs(rs - s)

	if (qDiff > rDiff && qDiff > sDiff) rq = -rr - rs
	else if (rDiff > sDiff) rr = -rq - rs

	return { q: rq, r: rr }
}

export function neighborCoords(q: number, r: number): HexCoord[] {
	return NEIGHBOR_DIRS.map(({ q: dq, r: dr }) => ({ q: q + dq, r: r + dr }))
}

/** Empty cells sharing an edge with any occupied plot — Catan-style expansion frontier. */
export function expansionCandidates(occupiedKeys: ReadonlySet<string>): HexCoord[] {
	const seen = new Set<string>()
	const out: HexCoord[] = []

	for (const key of occupiedKeys) {
		const { q, r } = parseHexKey(key)
		for (const neighbor of neighborCoords(q, r)) {
			const neighborKey = hexKey(neighbor.q, neighbor.r)
			if (occupiedKeys.has(neighborKey) || seen.has(neighborKey)) continue
			seen.add(neighborKey)
			out.push(neighbor)
		}
	}

	return out
}

export function axialDistance(a: HexCoord, b: HexCoord): number {
	return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

export function isInsideHex(worldX: number, worldY: number, q: number, r: number, radius: number): boolean {
	const cell = worldToAxial(worldX, worldY, radius)
	return cell.q === q && cell.r === r
}

/** Pick the frontier cell to preview when hovering outside occupied plots. */
export function nearestExpansionCandidate(
	worldX: number,
	worldY: number,
	radius: number,
	occupiedKeys: ReadonlySet<string>
): HexCoord | null {
	const candidates = expansionCandidates(occupiedKeys)
	if (candidates.length === 0) return null

	const pointerCell = worldToAxial(worldX, worldY, radius)
	const pointerKey = hexKey(pointerCell.q, pointerCell.r)
	if (!occupiedKeys.has(pointerKey)) {
		const direct = candidates.find((c) => c.q === pointerCell.q && c.r === pointerCell.r)
		if (direct) return direct
	}

	let best: HexCoord | null = null
	let bestDist = Infinity

	for (const candidate of candidates) {
		const center = axialToWorld(candidate.q, candidate.r, radius)
		const dx = worldX - center.x
		const dy = worldY - center.y
		const dist = dx * dx + dy * dy
		if (dist < bestDist) {
			bestDist = dist
			best = candidate
		}
	}

	return best
}

export function occupiedKeySet(plots: ReadonlyArray<{ q: number; r: number }>): Set<string> {
	return new Set(plots.map((plot) => hexKey(plot.q, plot.r)))
}
