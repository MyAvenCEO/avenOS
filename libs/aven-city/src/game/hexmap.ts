/**
 * Procedural hex island generation — pure data, no rendering.
 *
 * Shape: an organic land blob grown from the center, wrapped in a >=5-hex
 * thick ring of SEA tiles — the world is always an island (Catan rule).
 *
 * Biomes: TEN biomes, each extracting exactly one resource, assigned via a
 * weighted Voronoi over many scattered region centers — the same biome
 * recurs across the island in small-to-medium patches, never one huge blob.
 *
 * Water rules:
 *  - lakes form only inland (coastal water is stripped)
 *  - several lakes of different sizes may exist, but every lake is a real
 *    connected patch (>= 3 tiles) — scattered single-hex ponds are removed
 *  - the LARGEST lake carves a 1-tile river through the land to the sea
 *
 * Diversity: every hex carries its own 32-bit seed — decoration counts,
 * positions, scales and hue jitter all derive from it.
 */

import biomesConfig from '../config/biomes.json'
import { hash2, makeRng } from './rng'

export const BIOME_IDS = [
	'LAKE',
	'CLAYPIT',
	'FOREST',
	'GROVE',
	'MOUNTAIN',
	'ORECLIFF',
	'MEADOW',
	'DUNES'
] as const
export type BiomeId = (typeof BIOME_IDS)[number]

export const WATER_BIOME: BiomeId = 'LAKE'

/** biome -> natural resources, straight from game/config/biomes.json. */
export const BIOME_RESOURCES: Record<BiomeId, string[]> = Object.fromEntries(
	biomesConfig.biomes.map((b) => [b.id, Object.keys(b.resources)])
) as Record<BiomeId, string[]>

/** All resources a tile's biomes can (potentially) output. */
export function tileResources(tile: Pick<HexTile, 'biomes'>): string[] {
	return [...new Set(tile.biomes.flatMap((b) => BIOME_RESOURCES[b]))]
}

export interface HexTile {
	q: number
	r: number
	/** world-space center (flat-top layout, unit hex radius = 1) */
	x: number
	z: number
	kind: 'LAND' | 'SEA'
	/** 1-2 biomes for land, empty for sea */
	biomes: BiomeId[]
	/** split direction (radians, world xz) — secondary biome lies on +side */
	splitDir: number
	/** per-hex seed for all visual variation */
	seed: number
}

export interface HexWorld {
	seed: number
	tiles: HexTile[]
}

export const AXIAL_DIRS: ReadonlyArray<[number, number]> = [
	[1, 0],
	[1, -1],
	[0, -1],
	[-1, 0],
	[-1, 1],
	[0, 1]
]

export const key = (q: number, r: number) => `${q},${r}`

function axialToWorld(q: number, r: number): { x: number; z: number } {
	// flat-top layout, hex radius 1
	return { x: 1.5 * q, z: Math.sqrt(3) * (r + q / 2) }
}

function axialDistance(aq: number, ar: number, bq: number, br: number): number {
	const dq = aq - bq
	const dr = ar - br
	return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/** Grow an organic blob of hexes from the origin. */
function growBlob(seed: number, target: number): Array<[number, number]> {
	const rng = makeRng(seed ^ 0x51ab)
	const taken = new Map<string, [number, number]>()
	const frontier: Array<[number, number]> = [[0, 0]]
	taken.set(key(0, 0), [0, 0])

	while (taken.size < target && frontier.length > 0) {
		const idx = Math.floor(rng.next() ** 1.6 * frontier.length)
		const [q, r] = frontier[idx]
		const dirs = [...AXIAL_DIRS].sort(() => rng.next() - 0.5)
		let placed = false
		for (const [dq, dr] of dirs) {
			const nq = q + dq
			const nr = r + dr
			if (!taken.has(key(nq, nr))) {
				taken.set(key(nq, nr), [nq, nr])
				frontier.push([nq, nr])
				placed = true
				break
			}
		}
		if (!placed) frontier.splice(idx, 1)
	}
	return [...taken.values()]
}

interface RegionCenter {
	q: number
	r: number
	biome: BiomeId
	/** weighted Voronoi: larger weight -> larger patch */
	weight: number
}

const LAND_BIOMES: BiomeId[] = BIOME_IDS.filter((b) => b !== WATER_BIOME)

/**
 * How common each biome is. The island is a WOODED one: forest and its
 * softer cousins (grove, meadow) make up most of it, the productive
 * specialities are pockets you go looking for, and desert is rare. Numbers
 * are relative shares, not percentages — they drive both how many region
 * centers a biome gets and how far each of those regions spreads.
 */
const BIOME_ABUNDANCE: Record<string, number> = {
	FOREST: 10,
	MEADOW: 4.5,
	GROVE: 3.5,
	MOUNTAIN: 2,
	CLAYPIT: 1.4,
	ORECLIFF: 1.2,
	DUNES: 1
}

/**
 * Scatter MANY region centers over the blob — small-to-medium patches, every
 * biome recurring several times across the island. Narrow weight range keeps
 * patch sizes varied but never huge. Lakes get 2-4 interior centers.
 */
function placeRegions(
	rng: ReturnType<typeof makeRng>,
	cells: Array<[number, number]>,
	interior: Array<[number, number]>
): RegionCenter[] {
	const count = Math.max(14, Math.round(cells.length / 34)) + rng.int(0, 3)
	const lakeCount = rng.int(2, 4)

	const biomes: BiomeId[] = []
	for (let i = 0; i < lakeCount; i++) biomes.push(WATER_BIOME)
	// one center each so no biome is ever missing from a world...
	for (const b of LAND_BIOMES) biomes.push(b)
	// ...then fill the rest by abundance, so the island comes out mostly wooded
	const totalShare = LAND_BIOMES.reduce((s, b) => s + (BIOME_ABUNDANCE[b] ?? 1), 0)
	while (biomes.length < count) {
		let pick = rng.next() * totalShare
		let chosen = LAND_BIOMES[0]
		for (const b of LAND_BIOMES) {
			pick -= BIOME_ABUNDANCE[b] ?? 1
			if (pick <= 0) {
				chosen = b
				break
			}
		}
		biomes.push(chosen)
	}
	for (let i = biomes.length - 1; i > 0; i--) {
		const j = rng.int(0, i)
		;[biomes[i], biomes[j]] = [biomes[j], biomes[i]]
	}

	const centers: RegionCenter[] = []
	for (const biome of biomes) {
		const pool = biome === WATER_BIOME && interior.length > 0 ? interior : cells
		let best: [number, number] = rng.pick(pool)
		for (let attempt = 0; attempt < 16; attempt++) {
			const candidate = rng.pick(pool)
			const minDist = Math.min(
				Infinity,
				...centers.map((c) => axialDistance(candidate[0], candidate[1], c.q, c.r))
			)
			best = candidate
			if (minDist >= 3) break
		}
		// abundant biomes also claim more ground per center
		const pull = biome === WATER_BIOME ? 1 : 0.72 + 0.055 * (BIOME_ABUNDANCE[biome] ?? 1)
		centers.push({ q: best[0], r: best[1], biome, weight: rng.range(0.8, 1.35) * pull })
	}
	return centers
}

/**
 * Hexes in an island — sized to the city it is meant to hold.
 *
 * A level five hex houses 276 people, on land that also grows their food.
 * Under the zoning law 45% of the zonable ground may be lived on, and about
 * 1.1% of an island comes out as lake, which cannot be zoned at all. So:
 *
 *   10 580 × 0.9895 zonable × 0.45 living × 276 people ≈ 1.30 million
 *
 * Munich's population, on 3 800 km² rather than Munich's 311, because this
 * city grows the food Munich imports.
 */
export const MAP_SIZE = 10_580

export function generateMap(seed: number, size = MAP_SIZE): HexWorld {
	const rng = makeRng(seed)
	const cells = growBlob(seed, size)
	const landSet = new Set(cells.map(([q, r]) => key(q, r)))
	const isInterior = ([q, r]: [number, number]) =>
		AXIAL_DIRS.every(([dq, dr]) => landSet.has(key(q + dq, r + dr)))
	const interior = cells.filter(isInterior)
	const centers = placeRegions(rng, cells, interior)
	const coastal = (q: number, r: number) => !isInterior([q, r])

	// --- weighted low-jitter Voronoi: scattered, coherent patches -----------
	const assignments = new Map<string, { primary: RegionCenter; secondary?: RegionCenter }>()
	for (const [q, r] of cells) {
		const tileRng = makeRng(hash2(q, r, seed ^ 0x77))
		const ranked = centers
			.map((c) => ({
				c,
				d: (axialDistance(q, r, c.q, c.r) + tileRng.range(-0.15, 0.15)) / c.weight
			}))
			.sort((a, b) => a.d - b.d)
		const first = ranked[0]
		const second = ranked.find((e) => e.c.biome !== first.c.biome)
		assignments.set(key(q, r), {
			primary: first.c,
			secondary: second && second.d - first.d < 0.7 ? second.c : undefined
		})
	}

	// --- lakes form only inland: strip water from coastal tiles -------------
	const nearestDry = (q: number, r: number): RegionCenter =>
		centers
			.filter((c) => c.biome !== WATER_BIOME)
			.sort(
				(x, y) =>
					axialDistance(q, r, x.q, x.r) / x.weight - axialDistance(q, r, y.q, y.r) / y.weight
			)[0]
	for (const [q, r] of cells) {
		const a = assignments.get(key(q, r))!
		if (!coastal(q, r)) continue
		if (a.secondary?.biome === WATER_BIOME) a.secondary = undefined
		if (a.primary.biome === WATER_BIOME) {
			assignments.set(key(q, r), { primary: nearestDry(q, r) })
		}
	}

	// --- lakes must be REAL patches: connected components >= 3 tiles, at
	//     most the 5 largest survive; everything else becomes dry land -------
	const isWater = (q: number, r: number) =>
		assignments.get(key(q, r))?.primary.biome === WATER_BIOME
	const seen = new Set<string>()
	const components: Array<Array<[number, number]>> = []
	for (const [q, r] of cells) {
		if (!isWater(q, r) || seen.has(key(q, r))) continue
		const comp: Array<[number, number]> = []
		const queue: Array<[number, number]> = [[q, r]]
		seen.add(key(q, r))
		while (queue.length) {
			const [cq, cr] = queue.pop()!
			comp.push([cq, cr])
			for (const [dq, dr] of AXIAL_DIRS) {
				const nq = cq + dq
				const nr = cr + dr
				if (landSet.has(key(nq, nr)) && isWater(nq, nr) && !seen.has(key(nq, nr))) {
					seen.add(key(nq, nr))
					queue.push([nq, nr])
				}
			}
		}
		components.push(comp)
	}
	components.sort((a, b) => b.length - a.length)
	const lakes = components.filter((c, i) => c.length >= 3 && i < 5)
	const drowned = components.filter((c) => !lakes.includes(c))
	for (const comp of drowned) {
		for (const [q, r] of comp) assignments.set(key(q, r), { primary: nearestDry(q, r) })
	}

	// --- no scattered pond speckles: water secondaries survive only next to
	//     a real lake --------------------------------------------------------
	for (const [q, r] of cells) {
		const a = assignments.get(key(q, r))!
		if (a.secondary?.biome === WATER_BIOME && a.primary.biome !== WATER_BIOME) {
			const touchesWater = AXIAL_DIRS.some(([dq, dr]) => isWater(q + dq, r + dr))
			if (!touchesWater) a.secondary = undefined
		}
	}

	// --- guarantee at least one lake ----------------------------------------
	const lakeCenter = centers.find((c) => c.biome === WATER_BIOME)
	if (lakes.length === 0 && lakeCenter && interior.length > 0) {
		const spot = [...interior].sort(
			(a, b) =>
				axialDistance(a[0], a[1], lakeCenter.q, lakeCenter.r) -
				axialDistance(b[0], b[1], lakeCenter.q, lakeCenter.r)
		)[0]
		const lake: Array<[number, number]> = [spot]
		for (const [dq, dr] of AXIAL_DIRS) {
			const n: [number, number] = [spot[0] + dq, spot[1] + dr]
			if (interior.some(([q, r]) => q === n[0] && r === n[1]) && lake.length < 4) lake.push(n)
		}
		for (const [q, r] of lake) assignments.set(key(q, r), { primary: lakeCenter })
		lakes.push(lake)
	}

	// --- the river: the major lake flows to the sea --------------------------
	// BFS from the largest lake across land to the nearest coastal tile; the
	// path becomes a 1-tile water channel (exempt from the inland-only rule —
	// a river MOUTH is exactly where lake water meets the sea).
	if (lakes.length > 0 && lakeCenter) {
		const major = lakes[0]
		const inLake = new Set(major.map(([q, r]) => key(q, r)))
		const parent = new Map<string, string | null>()
		const queue: Array<[number, number]> = []
		for (const [q, r] of major) {
			parent.set(key(q, r), null)
			queue.push([q, r])
		}
		let mouth: string | null = null
		let qi = 0
		while (qi < queue.length && !mouth) {
			const [cq, cr] = queue[qi++]
			for (const [dq, dr] of AXIAL_DIRS) {
				const nq = cq + dq
				const nr = cr + dr
				const nk = key(nq, nr)
				if (!landSet.has(nk) || parent.has(nk)) continue
				parent.set(nk, key(cq, cr))
				if (coastal(nq, nr)) {
					mouth = nk
					break
				}
				queue.push([nq, nr])
			}
		}
		if (mouth) {
			let cursor: string | null = mouth
			while (cursor && !inLake.has(cursor)) {
				const [q, r] = cursor.split(',').map(Number)
				assignments.set(cursor, { primary: lakeCenter })
				cursor = parent.get(cursor) ?? null
			}
		}
	}

	// --- land tiles ----------------------------------------------------------
	const tiles: HexTile[] = cells.map(([q, r]) => {
		const { x, z } = axialToWorld(q, r)
		const hexSeed = hash2(q, r, seed)
		const a = assignments.get(key(q, r))!
		const biomes: BiomeId[] =
			a.secondary && a.secondary.biome !== a.primary.biome
				? [a.primary.biome, a.secondary.biome]
				: [a.primary.biome]
		let splitDir = makeRng(hexSeed).range(0, Math.PI * 2)
		if (a.secondary) {
			const sw = axialToWorld(a.secondary.q, a.secondary.r)
			splitDir = Math.atan2(sw.z - z, sw.x - x)
		}
		return { q, r, x, z, kind: 'LAND' as const, biomes, splitDir, seed: hexSeed }
	})

	// --- the sea ring: >=5 hexes of open water around every land tile --------
	const SEA_RING = 5
	const seaKeys = new Set<string>()
	let frontier = cells
	for (let ring = 0; ring < SEA_RING; ring++) {
		const next: Array<[number, number]> = []
		for (const [q, r] of frontier) {
			for (const [dq, dr] of AXIAL_DIRS) {
				const nq = q + dq
				const nr = r + dr
				const k = key(nq, nr)
				if (!landSet.has(k) && !seaKeys.has(k)) {
					seaKeys.add(k)
					next.push([nq, nr])
				}
			}
		}
		frontier = next
	}
	for (const k of seaKeys) {
		const [q, r] = k.split(',').map(Number)
		const { x, z } = axialToWorld(q, r)
		tiles.push({
			q,
			r,
			x,
			z,
			kind: 'SEA',
			biomes: [],
			splitDir: 0,
			seed: hash2(q, r, seed ^ 0x5ea)
		})
	}

	return { seed, tiles }
}
