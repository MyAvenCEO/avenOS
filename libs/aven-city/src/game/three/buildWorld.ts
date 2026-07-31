/**
 * Turns HexWorld data into a clay Three.js island.
 *
 * The board is FLAT and reads as ONE CONTINUOUS LANDSCAPE: every tile's top
 * is a finely tessellated disc whose vertex colors come from a smooth
 * CROSS-TILE COLOR FIELD — each vertex blends its own tile's biome color
 * with the neighbouring tiles' colors (inverse-distance weighting), so
 * terrain melts across hex borders instead of stopping at them. Water
 * contributes "wetness" to the same field, and a sandy shore band emerges
 * automatically wherever wetness crosses ~50%.
 *
 * COASTS ARE BEACHES, NOT CLIFFS: every sea-facing hex edge grows a sloping
 * sand skirt from the tile rim down under the waterline, so the island eases
 * into the (semi-transparent, shallow) water instead of ending in a cut
 * hexagon wall.
 *
 * PERFORMANCE: everything a tile owns — base prism, top disc, coast skirt,
 * all decorations — is merged into ONE vertex-colored mesh per tile. At
 * 1440 land tiles that is the difference between ~1.5k draw calls and ~40k.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { AXIAL_DIRS, type BiomeId, type HexTile, type HexWorld, key, WATER_BIOME } from '../hexmap'
import { hash2, makeRng, type Rng } from '../rng'
import {
	berryBush,
	birchTree,
	blobTree,
	broadleafTree,
	bush,
	cactus,
	cairn,
	clayBoulder,
	clayChunks,
	clayTerrace,
	communityStage,
	crystal,
	deadTree,
	digger,
	dome1,
	dome2,
	dome3,
	dome4,
	type FactoryKind,
	factoryDome,
	fallenLog,
	fern,
	fireCircle,
	flower,
	goldTuft,
	grassBlades,
	growDome,
	lilyPad,
	mountainPeaks,
	mudMound,
	mushrooms,
	oreRock,
	palm,
	peak,
	pebble,
	pickup,
	pine,
	pineTall,
	puffTree,
	reeds,
	rock,
	sheaf,
	sheep,
	shippingContainer,
	slabRock,
	stonePile,
	sunflower,
	tent1,
	tuft,
	twigSticks,
	van
} from './decorations'

const HEX_RADIUS = 1.0 // flush — tiles form one continuous ground
const HEX_HEIGHT = 0.5 // uniform — the board is flat
const BEVEL = 0.042 // soft crease between tiles
const CLAY_SIDE = '#f5edda'
const SHORE = '#ecdcae'
const WET_SAND = '#dcc79b'
const SUBMERGED = '#a9c9bd'
/** The open water tone. SEA tiles are never rendered as hexes — they exist
 * only as data so the coastal shore band computes; the visible sea is the
 * simulated water plane in water.ts. */
const SEA_TOP = '#5fa9bc'

interface BiomeSpec {
	top: string
	/** decorations per full hex (halved on split hexes) */
	density: [number, number]
	/** how far out pieces may spawn, as a fraction of the way to the hex
	 * outline (default 0.66 keeps a calm margin; woods go right up to it) */
	spread?: number
	/** extra size factor for this biome's pieces, on top of the global one */
	pieceScale?: number
	/** how far a piece's CENTRE stops short of the hex outline. Big pieces
	 * need a bigger margin or they hang over the edge; the default suits the
	 * small stuff. */
	edgeInset?: number
	deco: (rng: Rng) => THREE.Group
}

const BIOMES: Record<BiomeId, BiomeSpec> = {
	LAKE: {
		// v2 — sweet water from the low-poly refs: pale calm blue, faceted
		// lily pads with pale blossoms, chunky cattails.
		top: '#6fb9c9',
		density: [2, 4],
		deco: (rng) => (rng.chance(0.5) ? lilyPad(rng) : rng.chance(0.55) ? reeds(rng) : pebble(rng))
	},
	CLAYPIT: {
		// v2 — faceted low-poly: terraced dig mounds, crumpled terracotta
		// boulders, raw clay chunks, scorched dead trees. Sparse (a pit is
		// mostly open ground) and at half scale so the hexagon reads large.
		top: '#d69c66',
		density: [1, 3],
		deco: (rng) => {
			const d = rng.chance(0.32)
				? clayTerrace(rng)
				: rng.chance(0.38)
					? clayBoulder(rng)
					: rng.chance(0.55)
						? clayChunks(rng)
						: deadTree(rng)
			d.scale.multiplyScalar(0.5)
			return d
		}
	},
	FOREST: {
		// v3 — dense mixed woods at half piece scale. Trees dominate (~2/3 of
		// pieces: pines with birch and broadleaf accents); logs and stones
		// keep their old absolute density; the floor gets ferns, mushrooms,
		// twigs and grass for undergrowth fidelity.
		top: '#6cb254',
		// pieces are half the size they were, so the same counts read thin —
		// four times the old density to make a wood read as a wood again
		density: [184, 300],
		// woods run right up to the hex outline — a forest with a bald rim reads
		// as a board piece, not a forest
		spread: 1,
		// a mature pine came out taller than the great dome, which made a
		// settled hex read as a clearing in a giant wood rather than a town;
		// this puts the canopy just under the dome line
		pieceScale: 0.55,
		deco: (rng) => {
			const d = rng.chance(0.78)
				? // the canopy: three species
					rng.chance(0.7)
					? pineTall(rng)
					: rng.chance(0.5)
						? birchTree(rng)
						: broadleafTree(rng)
				: // the floor + debris layer
					rng.chance(0.3)
					? grassBlades(rng)
					: rng.chance(0.22)
						? fern(rng)
						: rng.chance(0.18)
							? mushrooms(rng)
							: rng.chance(0.2)
								? twigSticks(rng)
								: rng.chance(0.35)
									? fallenLog(rng)
									: rng.chance(0.55)
										? slabRock(rng)
										: stonePile(rng)
			d.scale.multiplyScalar(0.5)
			return d
		}
	},
	GROVE: {
		top: '#8ecb84',
		density: [6, 10],
		deco: (rng) =>
			rng.chance(0.4)
				? berryBush(rng)
				: rng.chance(0.35)
					? bush(rng)
					: rng.chance(0.4)
						? flower(rng)
						: blobTree(rng)
	},
	MOUNTAIN: {
		// v2 — faceted low-poly: peak clusters, mesas and spires of varied
		// steepness with snow-cap chance, stratified slabs, stone piles and
		// cairns. Peaks stay full-size on purpose — the skyline anchors.
		top: '#9aa3ad',
		density: [26, 46],
		// a range should run to the rim of its hex, not sit in a ring of bare
		// rock. Peak clusters are eight times wider than a tree, so they get
		// their own margin — reaching the edge without crossing it.
		spread: 1,
		edgeInset: 0.21,
		deco: (rng) =>
			rng.chance(0.5)
				? mountainPeaks(rng)
				: rng.chance(0.4)
					? slabRock(rng)
					: rng.chance(0.5)
						? stonePile(rng)
						: cairn(rng)
	},
	ORECLIFF: {
		top: '#9c9184',
		density: [3, 5],
		deco: (rng) =>
			rng.chance(0.45) ? oreRock(rng) : rng.chance(0.5) ? crystal(rng) : rock(rng, 1.2)
	},
	MEADOW: {
		top: '#a8da85',
		density: [4, 8],
		deco: (rng) =>
			rng.chance(0.14)
				? sheep(rng)
				: rng.chance(0.25)
					? flower(rng)
					: rng.chance(0.18)
						? bush(rng)
						: rng.chance(0.1)
							? blobTree(rng)
							: tuft(rng)
	},
	DUNES: {
		top: '#f0d99e',
		density: [2, 4],
		deco: (rng) =>
			rng.chance(0.42)
				? palm(rng)
				: rng.chance(0.35)
					? cactus(rng)
					: rng.chance(0.4)
						? puffTree(rng)
						: pebble(rng)
	}
}

function hexShape(radius: number): THREE.Shape {
	const shape = new THREE.Shape()
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI / 3) * i
		const x = Math.cos(a) * radius
		const y = Math.sin(a) * radius
		if (i === 0) shape.moveTo(x, y)
		else shape.lineTo(x, y)
	}
	shape.closePath()
	return shape
}

/**
 * Rounded clay prism — extruded hex with multi-segment bevel, depth -> +Y.
 *
 * 2 bevel segments rather than 3: the bevel is BEVEL wide on a hex of radius 1,
 * so the rounding is a couple of pixels at the zoom you actually play at, and
 * the third ring bought nothing you can see. It costs a third of every prism on
 * the island, twice over — once building the geometry, once drawing it.
 */
function hexPrism(radius: number, height: number): THREE.ExtrudeGeometry {
	const geo = new THREE.ExtrudeGeometry(hexShape(radius - BEVEL), {
		depth: height - BEVEL,
		bevelEnabled: true,
		bevelThickness: BEVEL,
		bevelSize: BEVEL,
		bevelSegments: 2
	})
	geo.rotateX(-Math.PI / 2)
	return geo
}

/** Per-hex tiny hue drift — subtle, so neighbouring tiles stay continuous. */
function driftedColor(hex: string, rng: Rng): THREE.Color {
	const c = new THREE.Color(hex)
	c.offsetHSL(rng.jitter(0, 0.004), rng.jitter(0, 0.015), rng.jitter(0, 0.01))
	return c
}

const smoothstep = (e0: number, e1: number, x: number): number => {
	const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
	return t * t * (3 - 2 * t)
}

/* ---------------------------------------------------------------------------
 * The cross-tile color field
 * ------------------------------------------------------------------------ */

interface TileStyle {
	tile: HexTile
	colorA: THREE.Color
	colorB: THREE.Color
	waterA: number
	waterB: number
	dirX: number
	dirZ: number
}

/** Sample a single tile's intra-tile blend at a world position. */
function sampleTile(s: TileStyle, wx: number, wz: number, out: THREE.Color): number {
	const lx = wx - s.tile.x
	const lz = wz - s.tile.z
	const t = smoothstep(-0.38, 0.38, lx * s.dirX + lz * s.dirZ)
	out.copy(s.colorA).lerp(s.colorB, t)
	return s.waterA + (s.waterB - s.waterA) * t
}

function buildStyles(world: HexWorld): Map<string, TileStyle> {
	const styles = new Map<string, TileStyle>()
	for (const tile of world.tiles) {
		const rng = makeRng(tile.seed ^ 0xc01)
		if (tile.kind === 'SEA') {
			const c = driftedColor(SEA_TOP, rng)
			styles.set(key(tile.q, tile.r), {
				tile,
				colorA: c,
				colorB: c,
				waterA: 1,
				waterB: 1,
				dirX: 1,
				dirZ: 0
			})
			continue
		}
		const a = tile.biomes[0]
		const b = tile.biomes[1] ?? a
		styles.set(key(tile.q, tile.r), {
			tile,
			colorA: driftedColor(BIOMES[a].top, rng),
			colorB: driftedColor(BIOMES[b].top, rng),
			waterA: a === WATER_BIOME ? 1 : 0,
			waterB: b === WATER_BIOME ? 1 : 0,
			dirX: Math.cos(tile.splitDir),
			dirZ: Math.sin(tile.splitDir)
		})
	}
	return styles
}

/**
 * Field color at a world position: inverse-distance blend of this tile and
 * its 6 neighbours. At a border midpoint the two tiles weigh 50/50 —
 * perfectly continuous terrain. Wetness rides the same blend; the sandy
 * shore appears wherever it passes through ~0.5.
 */
function makeFieldSampler(styles: Map<string, TileStyle>, shoreColor: THREE.Color) {
	const waterColor = new THREE.Color('#5fb7c9')
	const shoreR = shoreColor.r
	const shoreG = shoreColor.g
	const shoreB = shoreColor.b
	const waterR = waterColor.r
	const waterG = waterColor.g
	const waterB = waterColor.b

	// The seven styles a vertex blends are the same for every vertex of a hex,
	// and a tile's ground is some five thousand vertices. Looked up per vertex
	// that is seven string keys and seven map probes EACH TIME — thirty million
	// throwaway strings across an island, and half the reason a big world took
	// ten seconds to lay its ground. Looked up per tile it is nothing.
	//
	// The other half was shape: a Color is a small object, and copy/lerp on
	// seven of them per vertex is a hundred million property walks. Unpacked
	// into flat arrays the same blend is arithmetic the engine can keep in
	// registers.
	let cachedTile: HexTile | null = null
	let n = 0
	const cap = 7
	const sx = new Float64Array(cap)
	const sz = new Float64Array(cap)
	const ar = new Float64Array(cap)
	const ag = new Float64Array(cap)
	const ab = new Float64Array(cap)
	const br = new Float64Array(cap)
	const bg = new Float64Array(cap)
	const bb = new Float64Array(cap)
	const wa = new Float64Array(cap)
	const wb = new Float64Array(cap)
	const dx = new Float64Array(cap)
	const dz = new Float64Array(cap)

	function take(s: TileStyle | undefined): void {
		if (!s) return
		sx[n] = s.tile.x
		sz[n] = s.tile.z
		ar[n] = s.colorA.r
		ag[n] = s.colorA.g
		ab[n] = s.colorA.b
		br[n] = s.colorB.r
		bg[n] = s.colorB.g
		bb[n] = s.colorB.b
		wa[n] = s.waterA
		wb[n] = s.waterB
		dx[n] = s.dirX
		dz[n] = s.dirZ
		n++
	}

	/** Writes the blended color to `out`; returns the wetness (0 dry..1 water). */
	return (tile: HexTile, wx: number, wz: number, out: THREE.Color): number => {
		if (tile !== cachedTile) {
			cachedTile = tile
			n = 0
			take(styles.get(key(tile.q, tile.r)))
			for (const [dq, dr] of AXIAL_DIRS) take(styles.get(key(tile.q + dq, tile.r + dr)))
		}

		let sumW = 0
		let water = 0
		let r = 0
		let g = 0
		let b = 0
		for (let i = 0; i < n; i++) {
			const px = wx - sx[i]
			const pz = wz - sz[i]
			const e = Math.sqrt(px * px + pz * pz) + 0.12
			const w = 1 / (e * e * e)

			// the tile's own two-biome split, at this point
			let t = (px * dx[i] + pz * dz[i] + 0.38) / 0.76
			t = t < 0 ? 0 : t > 1 ? 1 : t
			t = t * t * (3 - 2 * t)

			r += (ar[i] + (br[i] - ar[i]) * t) * w
			g += (ag[i] + (bg[i] - ag[i]) * t) * w
			b += (ab[i] + (bb[i] - ab[i]) * t) * w
			water += (wa[i] + (wb[i] - wa[i]) * t) * w
			sumW += w
		}
		const inv = 1 / sumW
		r *= inv
		g *= inv
		b *= inv
		water *= inv

		// the shore: a soft sandy band where land turns to water. Outside about
		// three standard deviations the band contributes nothing, and skipping
		// it there skips an exp per vertex across the whole island
		const sd = (water - 0.5) / 0.16
		if (sd > -3.2 && sd < 3.2) {
			const k = Math.exp(-(sd * sd)) * 0.85
			r += (shoreR - r) * k
			g += (shoreG - g) * k
			b += (shoreB - b) * k
		}

		// water is WATER: wherever wetness wins, snap to solid stream blue so
		// rivers and lake narrows stay one continuous body with blue-on-blue
		// edges — never muddy land-tinted blends between water tiles
		if (water > 0.5) {
			const k = smoothstep(0.5, 0.68, water) * 0.9
			r += (waterR - r) * k
			g += (waterG - g) * k
			b += (waterB - b) * k
		}

		out.setRGB(r, g, b)
		return water
	}
}

/* ---------------------------------------------------------------------------
 * Geometry builders — everything returns world-space, vertex-colored,
 * non-indexed BufferGeometry with position/normal/color, ready to merge.
 * ------------------------------------------------------------------------ */

type FieldSampler = ReturnType<typeof makeFieldSampler>

function setUniformColor(
	geo: THREE.BufferGeometry,
	colorOf: (x: number, y: number, z: number) => THREE.Color
): void {
	const pos = geo.getAttribute('position')
	const arr = new Float32Array(pos.count * 3)
	for (let i = 0; i < pos.count; i++) {
		const c = colorOf(pos.getX(i), pos.getY(i), pos.getZ(i))
		arr[i * 3] = c.r
		arr[i * 3 + 1] = c.g
		arr[i * 3 + 2] = c.b
	}
	geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
}

/** The tile prism: bevel + top wear the field color (darkened toward the rim
 * so borders read as pressed furrows); walls stay clay. */
let prismTemplate: THREE.BufferGeometry | null = null

function buildBaseGeo(tile: HexTile, rng: Rng, field: FieldSampler): THREE.BufferGeometry {
	// every hex is the same prism; only the colours differ
	if (!prismTemplate) {
		prismTemplate = hexPrism(HEX_RADIUS, HEX_HEIGHT).toNonIndexed()
		prismTemplate.deleteAttribute('uv')
	}
	const geo = prismTemplate.clone()
	const sideColor = driftedColor(CLAY_SIDE, rng)
	const scratch = new THREE.Color()
	const bevelBottom = HEX_HEIGHT - BEVEL
	setUniformColor(geo, (x, y, z) => {
		if (y > bevelBottom - 0.001) {
			const t = Math.min(1, Math.max(0, (y - bevelBottom) / BEVEL))
			field(tile, tile.x + x, tile.z + z, scratch)
			scratch.multiplyScalar(0.955 + 0.04 * t)
			if (t < 0.3) scratch.lerp(sideColor, 1 - t / 0.3)
			return scratch
		}
		return sideColor
	})
	geo.translate(tile.x, 0, tile.z)
	return geo
}

/**
 * Finely tessellated top disc, vertex-colored by the cross-tile field.
 *
 * Built straight into typed arrays of a size worked out once. The disc is
 * FLAT — every normal is straight up — so the normals are filled rather than
 * derived; asking three to compute them meant a cross product per triangle,
 * two hundred a hex, to rediscover the same vector fifty thousand times an
 * island. That alone was most of what a big world spent on its ground.
 */
// 4, not 6. The disc is flat and its colours come from a field that is smooth
// across tile borders, so this only sets how finely that gradient is sampled
// INSIDE one hex — and a hex is small on screen. Dropping two steps takes the
// disc from 216 triangles to 96, i.e. 55% of the island's ground vertices, for
// a difference you have to zoom in to find.
const DISC_N = 4 // subdivisions per sector edge
const DISC_TRIS = 6 * DISC_N * DISC_N
const DISC_VERTS = DISC_TRIS * 3

/** The disc's triangle corners in tile-local xz, worked out once for all. */
const DISC_POINTS = (() => {
	const radius = HEX_RADIUS - BEVEL + 0.005
	const out = new Float64Array(DISC_VERTS * 2)
	let w = 0
	const corner = (i: number): [number, number] => [
		Math.cos((Math.PI / 3) * i) * radius,
		Math.sin((Math.PI / 3) * i) * radius
	]
	for (let s = 0; s < 6; s++) {
		const A = corner(s)
		const B = corner((s + 1) % 6)
		const point = (i: number, j: number): [number, number] => {
			const u = i / DISC_N
			const v = i === 0 ? 0 : j / i
			return [u * (A[0] + v * (B[0] - A[0])), u * (A[1] + v * (B[1] - A[1]))]
		}
		const tri = (a: [number, number], b: [number, number], c: [number, number]): void => {
			for (const [px, pz] of [a, c, b]) {
				out[w++] = px
				out[w++] = pz
			}
		}
		for (let i = 0; i < DISC_N; i++) {
			for (let j = 0; j <= i; j++) {
				tri(point(i, j), point(i + 1, j), point(i + 1, j + 1))
				if (j < i) tri(point(i, j), point(i + 1, j + 1), point(i, j + 1))
			}
		}
	}
	return out
})()

function buildTopDiscGeo(tile: HexTile, rng: Rng, field: FieldSampler): THREE.BufferGeometry {
	const positions = new Float32Array(DISC_VERTS * 3)
	const normals = new Float32Array(DISC_VERTS * 3)
	const colors = new Float32Array(DISC_VERTS * 3)
	const scratch = new THREE.Color()
	const y = HEX_HEIGHT + 0.004

	for (let t = 0; t < DISC_TRIS; t++) {
		// one shade jitter per triangle keeps the ground faceted rather than
		// smoothly graded — the clay look depends on it
		const dl = rng.jitter(0, 0.004)
		for (let k = 0; k < 3; k++) {
			const v = t * 3 + k
			const px = DISC_POINTS[v * 2]
			const pz = DISC_POINTS[v * 2 + 1]
			field(tile, tile.x + px, tile.z + pz, scratch)
			const o = v * 3
			positions[o] = tile.x + px
			positions[o + 1] = y
			positions[o + 2] = tile.z + pz
			normals[o + 1] = 1
			// the jitter is a lightness nudge, added straight to the channels.
			// offsetHSL would convert to HSL and back for it — five million
			// round trips an island to move a colour by four thousandths
			colors[o] = scratch.r + dl
			colors[o + 1] = scratch.g + dl
			colors[o + 2] = scratch.b + dl
		}
	}

	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
	geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
	geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
	return geo
}

/* --- the beach skirt ------------------------------------------------------ */

/** Edge k runs corner k -> corner k+1; its outward neighbour is EDGE_DIRS[k]
 * (world angle 30° + 60°·k in the flat-top axial layout). */
const EDGE_DIRS: ReadonlyArray<[number, number]> = [
	[1, 0],
	[0, 1],
	[-1, 1],
	[-1, 0],
	[0, -1],
	[1, -1]
]

/** Skirt profile: from the prism rim, ease outward and down under the water.
 * offsets are along the edge normal; heights are absolute Y. */
const SKIRT_RINGS = [
	{ out: 0, y: HEX_HEIGHT - BEVEL },
	{ out: 0.3, y: 0.38 },
	{ out: 0.7, y: 0.26 },
	{ out: 1.25, y: 0.1 }
]

/**
 * Sloping sand apron on every sea-facing edge (plus rounded corner fans
 * where two sea edges meet) — the island eases into the water as a beach
 * instead of ending in a cut hexagon wall.
 */
function buildSkirtGeo(
	tile: HexTile,
	rng: Rng,
	field: FieldSampler,
	isSea: (q: number, r: number) => boolean
): THREE.BufferGeometry | null {
	const seaEdge = EDGE_DIRS.map(([dq, dr]) => isSea(tile.q + dq, tile.r + dr))
	if (!seaEdge.some(Boolean)) return null

	const positions: number[] = []
	const colors: number[] = []
	const scratch = new THREE.Color()
	const wetSand = driftedColor(WET_SAND, rng)
	const submerged = driftedColor(SUBMERGED, rng)

	const ringColor = (ringIdx: number, wx: number, wz: number): THREE.Color => {
		if (ringIdx === 0) {
			field(tile, wx, wz, scratch)
			return scratch.clone().multiplyScalar(0.97)
		}
		if (ringIdx === 1) {
			field(tile, wx, wz, scratch)
			return scratch.clone().lerp(wetSand, 0.75).multiplyScalar(0.97)
		}
		if (ringIdx === 2) return wetSand.clone().lerp(submerged, 0.45)
		return submerged.clone()
	}

	const pushQuad = (
		a: THREE.Vector3,
		b: THREE.Vector3,
		c: THREE.Vector3,
		d: THREE.Vector3,
		ca: THREE.Color,
		cb: THREE.Color,
		cc: THREE.Color,
		cd: THREE.Color
	): void => {
		// two triangles: a-b-c, a-c-d (wound upward/outward)
		for (const [p, col] of [
			[a, ca],
			[b, cb],
			[c, cc],
			[a, ca],
			[c, cc],
			[d, cd]
		] as const) {
			positions.push(p.x, p.y, p.z)
			colors.push(col.r, col.g, col.b)
		}
	}

	const corner = (i: number): THREE.Vector2 =>
		new THREE.Vector2(
			tile.x + Math.cos((Math.PI / 3) * i) * HEX_RADIUS,
			tile.z + Math.sin((Math.PI / 3) * i) * HEX_RADIUS
		)

	const SEGS = 3
	for (let k = 0; k < 6; k++) {
		if (!seaEdge[k]) continue
		const A = corner(k)
		const B = corner(k + 1)
		const normalAngle = Math.PI / 6 + (Math.PI / 3) * k
		const nx = Math.cos(normalAngle)
		const nz = Math.sin(normalAngle)

		for (let s = 0; s < SEGS; s++) {
			const t0 = s / SEGS
			const t1 = (s + 1) / SEGS
			for (let r = 0; r < SKIRT_RINGS.length - 1; r++) {
				const R0 = SKIRT_RINGS[r]
				const R1 = SKIRT_RINGS[r + 1]
				const wobble = 1 + rng.jitter(0, 0.06)
				const p = (t: number, ring: typeof R0): THREE.Vector3 =>
					new THREE.Vector3(
						A.x + (B.x - A.x) * t + nx * ring.out * wobble,
						ring.y,
						A.y + (B.y - A.y) * t + nz * ring.out * wobble
					)
				const a = p(t0, R0)
				const b = p(t1, R0)
				const c = p(t1, R1)
				const d = p(t0, R1)
				pushQuad(
					a,
					b,
					c,
					d,
					ringColor(r, a.x, a.z),
					ringColor(r, b.x, b.z),
					ringColor(r + 1, c.x, c.z),
					ringColor(r + 1, d.x, d.z)
				)
			}
		}

		// rounded corner fan where the NEXT edge is also sea-facing
		const kn = (k + 1) % 6
		if (seaEdge[kn]) {
			const C = corner(k + 1)
			const angA = normalAngle
			const angB = Math.PI / 6 + (Math.PI / 3) * kn
			const FAN = 3
			for (let f = 0; f < FAN; f++) {
				const a0 = angA + ((angB - angA) * f) / FAN
				const a1 = angA + ((angB - angA) * (f + 1)) / FAN
				for (let r = 0; r < SKIRT_RINGS.length - 1; r++) {
					const R0 = SKIRT_RINGS[r]
					const R1 = SKIRT_RINGS[r + 1]
					const p = (ang: number, ring: typeof R0): THREE.Vector3 =>
						new THREE.Vector3(
							C.x + Math.cos(ang) * ring.out,
							ring.y,
							C.y + Math.sin(ang) * ring.out
						)
					const a = p(a0, R0)
					const b = p(a1, R0)
					const c = p(a1, R1)
					const d = p(a0, R1)
					pushQuad(
						a,
						b,
						c,
						d,
						ringColor(r, a.x, a.z),
						ringColor(r, b.x, b.z),
						ringColor(r + 1, c.x, c.z),
						ringColor(r + 1, d.x, d.z)
					)
				}
			}
		}
	}

	if (positions.length === 0) return null
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
	geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
	geo.computeVertexNormals()
	return geo
}

/* --- decorations ---------------------------------------------------------- */

/** Flatten a tile's decoration groups into one world-space geometry with the
 * material colors baked into vertex colors. */
/**
 * Distance from the hex center to its outline in a given direction. Pieces
 * are placed against THIS, not against the circumradius: a hexagon is 13%
 * narrower across its flats than across its corners, so a circular spawn
 * disc either wastes the corners or pushes pieces out over the edges.
 */
function hexOutlineAt(angle: number): number {
	const sector = Math.PI / 3
	const a = (((angle % sector) + sector) % sector) - sector / 2
	return (HEX_RADIUS * Math.cos(Math.PI / 6)) / Math.cos(a)
}

/** Pieces stop just short of the rim so nothing overhangs the tile edge. */
const EDGE_INSET = 0.12

/** A circle of ground a building owns; nature keeps out of it. */
export interface Clearing {
	x: number
	z: number
	/** how far nature is pushed back — generous, for breathing room */
	r: number
	/** how much space the structure itself takes — what collisions use */
	extent: number
}

/**
 * Flattens a built piece into ONE vertex-coloured geometry, baking each
 * mesh's material colour into its vertices, and disposes the originals.
 */
function flattenPiece(group: THREE.Group): THREE.BufferGeometry | null {
	group.updateMatrixWorld(true)
	const geos: THREE.BufferGeometry[] = []
	group.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return
		const geo = (obj.geometry as THREE.BufferGeometry).clone().toNonIndexed()
		geo.applyMatrix4(obj.matrixWorld)
		geo.deleteAttribute('uv')
		const count = geo.getAttribute('position').count
		const col = (obj.material as THREE.MeshStandardMaterial).color
		const arr = new Float32Array(count * 3)
		for (let i = 0; i < count; i++) {
			arr[i * 3] = col.r
			arr[i * 3 + 1] = col.g
			arr[i * 3 + 2] = col.b
		}
		geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
		geos.push(geo)
		obj.geometry.dispose()
		;(obj.material as THREE.Material).dispose()
	})
	if (geos.length === 0) return null
	const merged = mergeGeometries(geos, false)
	for (const g of geos) g.dispose()
	return merged
}

/**
 * A pool of pre-built variants per biome.
 *
 * Building every piece from scratch is what made a world take nine seconds:
 * a forest hex alone constructs some sixty pieces, each a little tree of
 * meshes and materials. Instead each biome builds a handful of variants ONCE,
 * and every hex places those — rotated, tilted and scaled per instance, so
 * the repetition does not read.
 */
const DECO_VARIANTS = 16
const variantPool = new Map<BiomeId, THREE.BufferGeometry[]>()

function biomeVariants(biome: BiomeId): THREE.BufferGeometry[] {
	const cached = variantPool.get(biome)
	if (cached) return cached
	const spec = BIOMES[biome]
	const variants: THREE.BufferGeometry[] = []
	for (let i = 0; i < DECO_VARIANTS; i++) {
		const geo = flattenPiece(spec.deco(makeRng(0x5eed + i * 7919 + biome.length * 131)))
		if (geo) variants.push(geo)
	}
	variantPool.set(biome, variants)
	return variants
}

/**
 * One decoration standing somewhere on a hex, stored as plain numbers.
 *
 * At four times the forest density a world plans some seventy thousand of
 * these; giving each one a Matrix4 costs more in allocation than the whole
 * rest of the build, so the transform is kept as numbers and composed into a
 * scratch matrix at the moment it is written to an instance.
 */
export interface DecoPlacement {
	biome: BiomeId
	variant: number
	/** tile-local position, so clearings can be tested without world offsets */
	px: number
	pz: number
	/** world position and turn */
	wx: number
	wz: number
	rotY: number
	scale: number
}

const __pos = new THREE.Vector3()
const __quat = new THREE.Quaternion()
const __scale = new THREE.Vector3()
const __euler = new THREE.Euler()
const __matrix = new THREE.Matrix4()

/** Composes a placement into the shared scratch matrix. */
function placementMatrix(p: {
	wx: number
	wz: number
	rotY: number
	scale: number
}): THREE.Matrix4 {
	__euler.set(0, p.rotY, 0)
	__quat.setFromEuler(__euler)
	__pos.set(p.wx, HEX_HEIGHT, p.wz)
	__scale.setScalar(p.scale)
	return __matrix.compose(__pos, __quat, __scale)
}

/**
 * Decides what stands where on a hex. Returns placements rather than
 * geometry: the world turns them into instanced meshes, and a hex can be
 * re-dressed around a new settlement without rebuilding any geometry.
 */
function planTileDeco(tile: HexTile, rng: Rng): DecoPlacement[] {
	const halves: Array<{ biome: BiomeId; sign: -1 | 1 | 0 }> =
		tile.biomes.length === 2
			? [
					{ biome: tile.biomes[0], sign: -1 },
					{ biome: tile.biomes[1], sign: 1 }
				]
			: [{ biome: tile.biomes[0], sign: 0 }]

	const dirX = Math.cos(tile.splitDir)
	const dirZ = Math.sin(tile.splitDir)
	const out: DecoPlacement[] = []

	for (const half of halves) {
		const spec = BIOMES[half.biome]
		const variants = biomeVariants(half.biome)
		if (variants.length === 0) continue

		let count = rng.int(spec.density[0], spec.density[1])
		if (tile.biomes.length === 2) count = Math.max(1, Math.round(count / 2))
		const spread = spec.spread ?? 0.66

		for (let i = 0; i < count; i++) {
			let px = 0
			let pz = 0
			let ok = false
			for (let tries = 0; tries < 14 && !ok; tries++) {
				const a = rng.range(0, Math.PI * 2)
				const reach = Math.max(0.1, hexOutlineAt(a) - (spec.edgeInset ?? EDGE_INSET)) * spread
				const d = Math.sqrt(rng.next()) * reach
				px = Math.cos(a) * d
				pz = Math.sin(a) * d
				const side = px * dirX + pz * dirZ
				ok = half.sign === 0 || (half.sign === 1 ? side > 0.3 : side < -0.3)
			}
			if (!ok) continue

			// Vegetation shrinks with the settlements (SITE_SCALE), so a tree
			// stays the right size NEXT TO A DOME rather than towering over
			// one. The count is untouched — the biome keeps its density, the
			// pieces are just smaller against a bigger-reading hex.
			out.push({
				biome: half.biome,
				variant: rng.int(0, variants.length - 1),
				px,
				pz,
				wx: tile.x + px,
				wz: tile.z + pz,
				rotY: rng.range(0, Math.PI * 2),
				scale: 0.1875 * SITE_SCALE * (spec.pieceScale ?? 1) * rng.range(0.88, 1.14)
			})
		}
	}

	return out
}

/* --- assembly ------------------------------------------------------------- */

/**
 * A single isolated tile of one biome — the sandbox specimen. Same builders
 * as the real world (base, disc, decorations; no coast skirt), so what the
 * sandbox shows is exactly what the island renders. `seed` varies the
 * decoration layout; a future `level` parameter will select the biome's
 * upgrade-level styling variants.
 */
export function buildBiomeTile(
	biome: BiomeId,
	seed: number,
	options: { building?: PlacedKind } = {}
): THREE.Object3D {
	const tile: HexTile = {
		q: 0,
		r: 0,
		x: 0,
		z: 0,
		kind: 'LAND',
		biomes: [biome],
		splitDir: 0,
		seed
	}
	const world: HexWorld = { seed, tiles: [tile] }
	const styles = buildStyles(world)
	const field = makeFieldSampler(styles, new THREE.Color(SHORE))
	const rng = makeRng(seed)

	const parts: THREE.BufferGeometry[] = [
		buildBaseGeo(tile, rng, field),
		buildTopDiscGeo(tile, rng, field)
	]
	const settlement =
		options.building && canBuildOn(biome)
			? isFactory(options.building)
				? makeFactory(tile, options.building)
				: makeSettlement(tile, BUILDINGS[options.building].level)
			: null
	const clearings = settlement?.clearings ?? []
	for (const p of planTileDeco(tile, makeRng(seed ^ 0xdec0))) {
		if (clearings.some((c) => Math.hypot(p.px - c.x, p.pz - c.z) < c.r)) continue
		const geo = biomeVariants(p.biome)[p.variant].clone()
		geo.applyMatrix4(placementMatrix(p))
		parts.push(geo)
	}
	const merged = mergeGeometries(parts, false)
	for (const p of parts) p.dispose()

	const mesh = new THREE.Mesh(
		merged ?? new THREE.BufferGeometry(),
		new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
	)
	mesh.castShadow = true
	mesh.receiveShadow = true
	if (!settlement) return mesh

	const group = new THREE.Group()
	group.add(mesh)
	group.add(settlement.object)
	return group
}

/** Nothing is founded on open water — a lake hex stays a lake hex. */
export function canBuildOn(biome: BiomeId): boolean {
	return biome !== WATER_BIOME
}

/** A hex takes a settlement only if it is land and no part of it is water. */
export function canBuildOnTile(tile: HexTile): boolean {
	return tile.kind === 'LAND' && tile.biomes.every(canBuildOn)
}

/* --- real-world scale ----------------------------------------------------
 * The board is abstract, but the sizes behind it are not. Two rules fix
 * everything below:
 *
 *   · an apartment houses 4 people in 150 m² — 37.5 m² of dwelling a person
 *   · a food forest feeds one person off 1 000 m² — 0.1 ha a head
 *
 * Apartments sit in an OUTER RING of each dome, stacked over its storeys.
 * The middle is COMMONS — kitchens, library, a place to talk, and growing
 * under glass. The great dome's middle is five times what it was, because it
 * farms indoors; the others are two and a half times. Multiplying an area
 * means growing its radius by that root, which is what sets each diameter:
 *
 *   dome         people  apts  dwelling/storey  storeys  ring   ⌀     commons/storey
 *   L2 glamping       4     1       150 m²           1     —     8 m        —
 *   L3 dome          12     3       225 m²           2   6.0 m   40 m     624 m²
 *   L4 dome          24     6       450 m²           2   7.5 m   70 m   2 380 m²
 *   L5 great dome    60    15       750 m²           3   9.0 m  136 m  10 950 m²
 *
 * Those are real spans, not fantasy ones: Gardens by the Bay's Flower Dome
 * covers about 138 m and the Eden Project's largest biome about 100 m. The
 * great dome is a botanical house that people also live around the edge of.
 *
 * The ring comes out larger than the apartments alone need; that surplus is
 * circulation, stairs and stores, which a real building spends anyway.
 *
 * Packed as the game arranges them the cluster is 357 m across — and the hex
 * is exactly as large as the food arithmetic below demands, no rounder and
 * no more generous: 749 m corner to corner, 36.5 ha. The map draws it at
 * that ratio, so what you see on a hex is the real spacing.
 *
 * FEEDING IT. Glass is not a magic multiplier, and this was treating it
 * like one. Two corrections, both of which cost land:
 *
 *   YIELD. The 10x greenhouse figures are Dutch high-tech glasshouses —
 *   heated, artificially lit, CO2-enriched, hydroponic, fossil-fed at every
 *   step. A passive-solar dome is a season-extender, not a factory. Taken
 *   at 4x open field for the crops that suit it.
 *
 *   WHAT IT CAN GROW — the real limit, and the one that was missed. Glass
 *   grows fruit, vegetables, herbs, exotics, and fish where the beds are
 *   aquaponic. It does not grow STAPLES: nobody puts wheat, pulses or
 *   oilseed under glass, because the calories per m² never repay the
 *   structure. Fruit and vegetables are a small share of dietary CALORIES
 *   however much of the plate they cover. Allowing 20% — the fruit and veg
 *   outright, plus aquaponic protein — is already the generous end.
 *
 * So indoors is capped by DIET SHARE, not by floor area:
 *
 *   houses                        276
 *   must feed                     331   = 276 + 20%
 *
 *   cluster            ⌀357 m,  10.0 ha
 *   indoor beds         1.7 ha needed    feeds  66   (20% of the diet)
 *   open permaculture  26.5 ha           feeds 265   (the other 80%)
 *   HEX                ⌀749 m,  36.5 ha  feeds 331   exactly +20%
 *
 *   cluster : hex radius   48%
 *   settled : hex area     27%
 *   open    : hex area     73%
 *   land per person     1 322 m²
 *
 * The hex grew from 631 m to 749 m to pay for that correction. The domes
 * kept their glass — 3.4 ha of beds where food needs 1.7 — and the rest is
 * what commons are for.
 *
 * The works grows nothing: it is a works. Its own land is farmable like any
 * hex, but that is the land's doing, not the factory's.
 * ------------------------------------------------------------------------ */

/** Hex circumradius in metres — the scale everything else is read against. */
export const HEX_RADIUS_M = 375

/** A hex's land, in hectares. */
export const HEX_HA = (((3 * Math.sqrt(3)) / 2) * HEX_RADIUS_M ** 2) / 10_000
/** The settlement cluster at level 5 — domes plus the commons between them. */
export const CLUSTER_M = 357
export const CLUSTER_HA = (Math.PI * (CLUSTER_M / 2) ** 2) / 10_000
/** What a settled hex has left to grow on. */
export const OPEN_HA = HEX_HA - CLUSTER_HA
/** Indoor beds carry a fifth of the diet; the open land carries the rest. */
export const INDOOR_DIET_SHARE = 0.2

/* --- settlements ---------------------------------------------------------
 * A hex is not one building — it is a settlement that grows OUTSIDE IN.
 * Level 1 pitches tents around the edge of the site; each level after that
 * lays a tighter ring of larger domes inside the last, until level 5 sets the
 * great dome in the middle.
 *
 * Levels build on each other, but the TEMPORARY housing retires as people
 * move up: the glamping ring replaces the tents, and the first permanent
 * domes replace the glamping ring. From there the rings accumulate, so the
 * hex reads as a camp that became a town.
 * ------------------------------------------------------------------------ */

export type BuildingKind = 'TENT' | 'GLAMP' | 'DOME3' | 'DOME4' | 'DOME5'

interface BuildingSpec {
	label: string
	/** the level this ring is added at */
	level: number
	/** people housed per dome — zero when it is not housing at all */
	capacity: number
	/** what it is for, beyond housing */
	purpose?: string
	/** real-world diameter in metres (see the scale note above) */
	diameterM: number
	/** how many of them this level lays down */
	count: number
	/** distance from the hex center, in hex radii; 0 puts it in the middle */
	radius: number
	/** true scatters them instead of spacing them evenly around the ring */
	scatter?: boolean
	/** stand on another level's ring, on exactly its spots */
	alignWith?: BuildingKind
	/** world scale — a hex is 2 units across */
	scale: number
	/** ground each one claims, in hex radii — nature keeps out of this */
	footprint: number
	/** how much room the structure itself needs, for not colliding */
	extent: number
	/** housing this level makes obsolete — its people move up into this one */
	retires?: BuildingKind
	build: (rng: Rng) => THREE.Group
}

/** A shared structure a level brings besides its housing. */
interface SitePiece {
	count: number
	/** distance from the hex centre, in hex radii; 0 puts it in the middle */
	radius: number
	scale: number
	/** ground nature keeps out of */
	footprint: number
	/** how much room the structure itself needs, for not colliding */
	extent: number
	/** true drops them wherever there is room instead of spacing them evenly */
	scatter?: boolean
	/** sit in the GAPS of another level's ring, at its radius */
	between?: BuildingKind
	/** the levels this piece stands through, inclusive */
	fromLevel: number
	untilLevel: number
	build: (rng: Rng, index: number) => THREE.Group
}

/**
 * The kit a founding crew lands with. It outlives the tents: people move
 * into the glamping domes at level 2 but still cook, work, store and gather
 * around the same camp, so the containers and the fire stand until the first
 * permanent domes arrive.
 */
const SITE_PIECES: SitePiece[] = [
	{
		// kitchen, workshop, utilities and store, squared off around the fire
		count: 4,
		// level 1 has nothing else to dodge, so the camp packs in tight
		radius: 0.42,
		scale: 0.11,
		footprint: 0.24,
		extent: 0.155,
		fromLevel: 1,
		untilLevel: 1,
		build: (rng, i) =>
			shippingContainer(rng, (['KITCHEN', 'WORKSHOP', 'UTILITY', 'STORAGE'] as const)[i % 4])
	},
	{
		// the same four containers at level 2, pushed out to clear the domes:
		// four among six can never be more than 15 degrees off one
		count: 4,
		radius: 0.68,
		scale: 0.11,
		footprint: 0.24,
		extent: 0.155,
		fromLevel: 2,
		untilLevel: 2,
		build: (rng, i) =>
			shippingContainer(rng, (['KITCHEN', 'WORKSHOP', 'UTILITY', 'STORAGE'] as const)[i % 4])
	},
	{
		// the fire everyone gathers at, in the middle of the camp
		count: 1,
		radius: 0,
		scale: 0.055,
		footprint: 0.14,
		extent: 0.14,
		fromLevel: 1,
		untilLevel: 2,
		build: (rng) => fireCircle(rng)
	},
	{
		// the crew's vehicles, parked wherever there was room
		count: 2,
		radius: 0.72,
		scale: 0.11,
		footprint: 0.13,
		extent: 0.09,
		scatter: true,
		fromLevel: 1,
		untilLevel: 2,
		build: (rng, i) => (i === 0 ? pickup(rng) : van(rng))
	},

	// --- level 3: the camp becomes a building site ---------------------
	{
		// six containers, one in each gap of the dome ring
		count: 6,
		radius: 0.62,
		scale: 0.11,
		footprint: 0.22,
		extent: 0.155,
		between: 'DOME3',
		fromLevel: 3,
		untilLevel: 3,
		build: (rng, i) =>
			shippingContainer(
				rng,
				(['KITCHEN', 'WORKSHOP', 'UTILITY', 'STORAGE', 'STORAGE', 'WORKSHOP'] as const)[i % 6]
			)
	},
	{
		// the fire has become a place to gather: a stage under a canopy, with
		// the hearth still burning at its foot
		count: 1,
		radius: 0,
		scale: 0.075,
		footprint: 0.24,
		extent: 0.24,
		fromLevel: 3,
		untilLevel: 3,
		build: (rng) => communityStage(rng)
	},
	{
		// the machines that turn a camp into a site
		count: 5,
		radius: 0.8,
		scale: 0.11,
		footprint: 0.13,
		extent: 0.09,
		scatter: true,
		fromLevel: 3,
		untilLevel: 3,
		build: (rng, i) => (i < 2 ? digger(rng) : i < 4 ? pickup(rng) : van(rng))
	},

	// --- level 4: the site works on, outside the finished rings ---------
	{
		// containers pushed out beyond the domes, where there is still room
		count: 6,
		radius: 0.7,
		scale: 0.11,
		footprint: 0.22,
		extent: 0.155,
		between: 'DOME3',
		fromLevel: 4,
		untilLevel: 4,
		build: (rng, i) =>
			shippingContainer(
				rng,
				(['STORAGE', 'WORKSHOP', 'UTILITY', 'STORAGE', 'KITCHEN', 'WORKSHOP'] as const)[i % 6]
			)
	},
	{
		// the machines that will raise the great dome
		count: 5,
		radius: 0.84,
		scale: 0.11,
		footprint: 0.13,
		extent: 0.09,
		scatter: true,
		fromLevel: 4,
		untilLevel: 4,
		build: (rng, i) => (i < 3 ? digger(rng) : i === 3 ? pickup(rng) : van(rng))
	}
]

/**
 * How much of a hex a settlement is allowed to cover.
 *
 * Everything below — every ring radius, every building scale, every clearing
 * — is written at full-hex proportions and then multiplied by this. At a half
 * it leaves the whole outer ring of the hex open, which is the ground the
 * permaculture will need once a settlement is grown.
 */
const SITE_SCALE = 0.663

/** Ordered outside-in: the first entry sits furthest out, the last in the middle. */
export const BUILDINGS: Record<BuildingKind, BuildingSpec> = {
	TENT: {
		label: 'Level 1',
		level: 1,
		capacity: 2,
		diameterM: 5,
		count: 6,
		// pitched close in around the camp, not spread across the plot
		radius: 0.62,
		scatter: true,
		scale: 0.045,
		footprint: 0.11,
		extent: 0.06,
		build: tent1
	},
	GLAMP: {
		label: 'Level 2',
		level: 2,
		capacity: 4,
		diameterM: 8,
		count: 6,
		// the glamping domes take the spots the level 4 ring will later fill,
		// so the camp's first permanent circle is where the town's is
		alignWith: 'DOME4',
		radius: 0.42,
		scale: 0.055,
		footprint: 0.09,
		extent: 0.085,
		retires: 'TENT',
		build: dome1
	},
	DOME3: {
		label: 'Level 3',
		level: 3,
		capacity: 12,
		diameterM: 40,
		purpose: 'apartments ring a wide commons',
		count: 6,
		radius: 0.58,
		scale: 0.07,
		footprint: 0.1,
		extent: 0.1,
		retires: 'GLAMP',
		build: dome2
	},
	DOME4: {
		label: 'Level 4',
		level: 4,
		capacity: 24,
		diameterM: 70,
		purpose: 'apartments ring a wide commons',
		count: 6,
		radius: 0.42,
		scale: 0.08,
		footprint: 0.13,
		extent: 0.13,
		build: dome3
	},
	DOME5: {
		label: 'Level 5',
		level: 5,
		// apartments in its outer storeys, and the whole middle given over to
		// the commons — kitchens, library, gathering — and indoor growing
		capacity: 60,
		diameterM: 136,
		purpose: 'commons + indoor growing',
		count: 1,
		radius: 0,
		// grown until it nearly touches the six domes ringed around it: their
		// ring sits at 0.42 and each reaches 0.13 inward, leaving 0.29
		scale: 0.112,
		footprint: 0.28,
		extent: 0.275,
		build: dome4
	}
}

/* --- factories -----------------------------------------------------------
 * A hex is a settlement OR a works. A factory is one shell over the same
 * ground the settlement cluster covers, so the two are alternatives for a
 * plot rather than things that stack.
 * ------------------------------------------------------------------------ */

export type { FactoryKind }

interface FactorySpec {
	label: string
	/** what it makes, for the rail */
	output: string
	/** real-world diameter of the works shell, in metres */
	diameterM: number
	/** world scale — sized so the dome spans the settlement cluster */
	scale: number
	/** ground it claims, in hex radii */
	footprint: number
	build: (rng: Rng, kind: FactoryKind) => THREE.Group
}

export const FACTORIES: Record<FactoryKind, FactorySpec> = {
	SOLAR: {
		label: 'Solar Works',
		output: 'solar panels',
		diameterM: 130,
		// a third smaller, then a quarter smaller again — a works should read
		// as the biggest thing on its hex, not as a lid over it
		scale: 0.19,
		footprint: 0.28,
		build: factoryDome
	}
}

export const FACTORY_KINDS = Object.keys(FACTORIES) as FactoryKind[]

/** Anything a hex can carry: a settlement level, or a works. */
export type PlacedKind = BuildingKind | FactoryKind

export function isFactory(kind: PlacedKind): kind is FactoryKind {
	return kind in FACTORIES
}

/** Puts a works on a hex, and hands back the ground it claims. */
const factoryPool = new Map<string, THREE.Object3D>()

function factoryVariant(kind: FactoryKind, variant: number): THREE.Object3D {
	const key = `${kind}#${variant}`
	const cached = factoryPool.get(key)
	if (cached) return cached
	const spec = FACTORIES[kind]
	const group = new THREE.Group()
	const rng = makeRng(0xfac70 + variant * 7919)
	const object = spec.build(rng, kind)
	object.scale.setScalar(spec.scale)
	object.position.set(0, HEX_HEIGHT, 0)
	object.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.castShadow = true
			o.receiveShadow = true
		}
	})
	group.add(object)

	const flat = flattenSettlement(group)
	factoryPool.set(key, flat)
	return flat
}

/** Puts a works on a hex, and hands back the ground it claims. */
function makeFactory(
	tile: HexTile,
	kind: FactoryKind
): { object: THREE.Object3D; clearings: Clearing[] } {
	const spec = FACTORIES[kind]
	const built = factoryVariant(kind, Math.abs(tile.seed) % SETTLEMENT_VARIANTS)
	const group = new THREE.Group()
	for (const child of built.children) {
		if (!(child instanceof THREE.Mesh)) continue
		const mesh = new THREE.Mesh(child.geometry, child.material)
		mesh.castShadow = child.castShadow
		mesh.receiveShadow = child.receiveShadow
		group.add(mesh)
	}
	group.position.set(tile.x, 0, tile.z)
	return {
		object: group,
		clearings: [{ x: 0, z: 0, r: spec.footprint, extent: spec.footprint }]
	}
}

/** Every level in build order, outside first. */
export const BUILD_ORDER: BuildingKind[] = (Object.keys(BUILDINGS) as BuildingKind[]).sort(
	(a, b) => BUILDINGS[a].level - BUILDINGS[b].level
)

/**
 * What actually stands on a hex built to `level`: everything laid up to it,
 * minus the housing that later levels retired.
 */
export function settlementKinds(level: number): BuildingKind[] {
	const built = BUILD_ORDER.filter((k) => BUILDINGS[k].level <= level)
	const retired = new Set(built.map((k) => BUILDINGS[k].retires).filter(Boolean))
	return built.filter((k) => !retired.has(k))
}

/** People housed by a settlement built up to and including `level`. */
export function settlementCapacity(level: number): number {
	return settlementKinds(level).reduce(
		(sum, k) => sum + BUILDINGS[k].capacity * BUILDINGS[k].count,
		0
	)
}

export function buildingForLevel(level: number): BuildingKind | null {
	return BUILD_ORDER.find((k) => BUILDINGS[k].level === level) ?? null
}

/**
 * Flattens a whole settlement into two meshes — everything solid, and the
 * glass — baking each part's colour into its vertices.
 *
 * A settlement is a dozen buildings of some seventy parts each; left as a
 * tree of meshes it costs a thousand draw calls per hex, which a handful of
 * founded hexes turns into a slideshow. Near-opaque panels (the glamping
 * canvas) count as solid, so only real glass pays for transparency.
 */
function flattenSettlement(root: THREE.Object3D): THREE.Group {
	root.updateMatrixWorld(true)
	const solid: THREE.BufferGeometry[] = []
	const glass: THREE.BufferGeometry[] = []

	root.traverse((obj) => {
		if (!(obj instanceof THREE.Mesh)) return
		const mat = obj.material as THREE.MeshStandardMaterial
		const geo = (obj.geometry as THREE.BufferGeometry).clone().toNonIndexed()
		geo.applyMatrix4(obj.matrixWorld)
		geo.deleteAttribute('uv')
		const count = geo.getAttribute('position').count
		const arr = new Float32Array(count * 3)
		if (mat.vertexColors && geo.getAttribute('color')) {
			// already coloured per vertex (the glass panes)
		} else {
			for (let i = 0; i < count; i++) {
				arr[i * 3] = mat.color.r
				arr[i * 3 + 1] = mat.color.g
				arr[i * 3 + 2] = mat.color.b
			}
			geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
		}
		;(mat.transparent && mat.opacity < 0.9 ? glass : solid).push(geo)
		obj.geometry.dispose()
		mat.dispose()
	})

	const group = new THREE.Group()
	// a camp has no glass at all, and merging nothing throws
	const solidGeo = solid.length > 0 ? mergeGeometries(solid, false) : null
	if (solidGeo) {
		const mesh = new THREE.Mesh(
			solidGeo,
			new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 0.85,
				metalness: 0,
				flatShading: true
			})
		)
		mesh.castShadow = true
		mesh.receiveShadow = true
		group.add(mesh)
	}
	const glassGeo = glass.length > 0 ? mergeGeometries(glass, false) : null
	if (glassGeo) {
		const mesh = new THREE.Mesh(
			glassGeo,
			new THREE.MeshStandardMaterial({
				vertexColors: true,
				roughness: 0.22,
				metalness: 0.05,
				flatShading: true,
				transparent: true,
				opacity: 0.66,
				side: THREE.DoubleSide
			})
		)
		// glass casting a solid shadow reads as a dark blob under the dome
		mesh.castShadow = false
		mesh.receiveShadow = true
		group.add(mesh)
	}
	for (const g of [...solid, ...glass]) g.dispose()
	return group
}

/**
 * Lays out a settlement built up to `level` on a hex: every ring from the
 * outside in, cumulative. Returns the object to add and the ground each
 * building claims, so the tile's nature can be re-scattered around them.
 */
function buildSettlementAtOrigin(
	seed: number,
	level: number
): { object: THREE.Object3D; clearings: Clearing[] } {
	const tile = { x: 0, z: 0, seed } as HexTile
	const group = new THREE.Group()
	const clearings: Clearing[] = []
	const rng = makeRng(seed ^ 0x5e77)

	for (const kind of settlementKinds(level)) {
		const spec = BUILDINGS[kind]

		for (let i = 0; i < spec.count; i++) {
			let px = 0
			let pz = 0

			const specRadius = spec.radius * SITE_SCALE
			const specExtent = spec.extent * SITE_SCALE
			if (specRadius > 0) {
				if (spec.scatter) {
					// tents go wherever there is still room, so they read as a
					// camp rather than a formation
					let placed = false
					for (let tries = 0; tries < 24 && !placed; tries++) {
						const a = rng.range(0, Math.PI * 2)
						const d = specRadius * rng.range(0.82, 1.12)
						px = Math.cos(a) * d
						pz = Math.sin(a) * d
						placed =
							Math.hypot(px, pz) + specExtent < hexOutlineAt(a) - 0.04 &&
							!clearings.some((c) => Math.hypot(px - c.x, pz - c.z) < c.extent + specExtent)
					}
					if (!placed) continue
				} else {
					// each ring is turned half a step against the one outside it,
					// so domes sit in the gaps rather than lining up radially —
					// unless it is pinned to another ring's spots
					const ring = spec.alignWith ? BUILDINGS[spec.alignWith] : spec
					const a = (Math.PI * 2 * i) / ring.count + (ring.level * Math.PI) / ring.count
					px = Math.cos(a) * ring.radius * SITE_SCALE
					pz = Math.sin(a) * ring.radius * SITE_SCALE
				}
			}

			const object = spec.build(makeRng(tile.seed ^ (0xb000 + spec.level * 16 + i)))
			object.scale.setScalar(spec.scale * SITE_SCALE)
			object.position.set(tile.x + px, HEX_HEIGHT, tile.z + pz)
			object.traverse((o) => {
				if (o instanceof THREE.Mesh) {
					o.castShadow = true
					o.receiveShadow = true
				}
			})
			group.add(object)
			clearings.push({ x: px, z: pz, r: spec.footprint * SITE_SCALE, extent: specExtent })
		}
	}

	// --- the shared camp, after all housing so it can dodge it ------------
	const placePiece = (piece: SitePiece, px: number, pz: number, i: number): void => {
		const object = piece.build(makeRng(tile.seed ^ (0xc0de + piece.fromLevel * 64 + i + 1)), i)
		object.scale.setScalar(piece.scale * SITE_SCALE)
		object.position.set(tile.x + px, HEX_HEIGHT, tile.z + pz)
		object.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.castShadow = true
				o.receiveShadow = true
			}
		})
		group.add(object)
		clearings.push({
			x: px,
			z: pz,
			r: piece.footprint * SITE_SCALE,
			extent: piece.extent * SITE_SCALE
		})
	}

	/** True when a structure at this spot touches nothing already standing. */
	const isClear = (px: number, pz: number, extent: number): boolean =>
		!clearings.some((c) => Math.hypot(px - c.x, pz - c.z) < c.extent + extent)

	for (const piece of SITE_PIECES) {
		if (level < piece.fromLevel || level > piece.untilLevel) continue
		const rng = makeRng(tile.seed ^ (0xc0de + piece.fromLevel * 64))
		const pieceRadius = piece.radius * SITE_SCALE
		const pieceExtent = piece.extent * SITE_SCALE

		if (piece.scatter) {
			for (let i = 0; i < piece.count; i++) {
				const own = makeRng(tile.seed ^ (0xc0de + piece.fromLevel * 64 + i + 1))
				for (let tries = 0; tries < 30; tries++) {
					const a = own.range(0, Math.PI * 2)
					const d = pieceRadius * own.range(0.7, 1.25)
					const px = Math.cos(a) * d
					const pz = Math.sin(a) * d
					if (Math.hypot(px, pz) + pieceExtent > hexOutlineAt(a) - 0.04) continue
					if (!isClear(px, pz, pieceExtent)) continue
					placePiece(piece, px, pz, i)
					break
				}
			}
			continue
		}

		if (pieceRadius === 0) {
			placePiece(piece, 0, 0, 0)
			continue
		}

		// pinned into the gaps of a housing ring: half a step off its spots,
		// so a container always stands between two domes
		if (piece.between) {
			const ring = BUILDINGS[piece.between]
			const ringPhase = (ring.level * Math.PI) / ring.count
			for (let i = 0; i < piece.count; i++) {
				const a = (Math.PI * 2 * i) / piece.count + ringPhase + Math.PI / ring.count
				placePiece(piece, Math.cos(a) * pieceRadius, Math.sin(a) * pieceRadius, i)
			}
			continue
		}

		// The ring turns as ONE: every spot is spaced evenly, and the whole
		// ring rotates until it finds an angle where none of its pieces lands
		// on a dome. Nudging pieces individually would fix the collision and
		// lose the even spacing, which is the point of the ring.
		const start = rng.range(0, Math.PI * 2)
		const STEPS = 48
		let phase = start
		let bestPhase = start
		let bestClearance = -Infinity
		for (let step = 0; step < STEPS; step++) {
			phase = start + (step * Math.PI * 2) / (STEPS * piece.count)
			let worst = Infinity
			for (let i = 0; i < piece.count; i++) {
				const a = (Math.PI * 2 * i) / piece.count + phase
				const px = Math.cos(a) * pieceRadius
				const pz = Math.sin(a) * pieceRadius
				for (const c of clearings) {
					worst = Math.min(worst, Math.hypot(px - c.x, pz - c.z) - c.extent - pieceExtent)
				}
			}
			if (worst > bestClearance) {
				bestClearance = worst
				bestPhase = phase
			}
			if (worst > 0) break // clear of everything: good enough
		}

		for (let i = 0; i < piece.count; i++) {
			const a = (Math.PI * 2 * i) / piece.count + bestPhase
			placePiece(piece, Math.cos(a) * pieceRadius, Math.sin(a) * pieceRadius, i)
		}
	}

	return { object: flattenSettlement(group), clearings }
}

/**
 * A pool of pre-built settlements per level.
 *
 * Raising a whole span to level five means placing hundreds of settlements,
 * and each is a dozen buildings of some seventy parts. Built per hex that is
 * tens of seconds of blocked main thread; built ONCE per variant and shared,
 * placing one is a couple of meshes pointing at geometry that already exists.
 */
const SETTLEMENT_VARIANTS = 8
const settlementPool = new Map<string, ReturnType<typeof buildSettlementAtOrigin>>()

function settlementVariant(level: number, variant: number) {
	const key = `${level}#${variant}`
	const cached = settlementPool.get(key)
	if (cached) return cached
	const built = buildSettlementAtOrigin(0x5e771 + variant * 7919 + level * 131, level)
	settlementPool.set(key, built)
	return built
}

/** Places a settlement of the given level on a hex, reusing a pooled build. */
function makeSettlement(
	tile: HexTile,
	level: number
): { object: THREE.Object3D; clearings: Clearing[] } {
	const variant = Math.abs(tile.seed) % SETTLEMENT_VARIANTS
	const built = settlementVariant(level, variant)
	// the pooled build owns its geometry; every hex gets its own light node
	// pointing at it, positioned over the tile
	const group = new THREE.Group()
	for (const child of built.object.children) {
		if (!(child instanceof THREE.Mesh)) continue
		const mesh = new THREE.Mesh(child.geometry, child.material)
		mesh.castShadow = child.castShadow
		mesh.receiveShadow = child.receiveShadow
		group.add(mesh)
	}
	group.position.set(tile.x, 0, tile.z)
	return { object: group, clearings: built.clearings }
}

/**
 * What the island is, in people and in land.
 *
 * The land splits three ways, and the three are NOT interchangeable. A living
 * hex's open ground is the food forest that feeds the people standing on it —
 * every settlement carries its own. A works hex's open ground is industrial
 * crop: hemp, bamboo, fibre, the feedstock the dome in the middle turns into
 * something. And a hex nobody has touched is reserve — it grows nothing for
 * anyone, which is the whole point of it.
 */
export interface WorldStats {
	citizens: number
	settlements: number
	works: number
	/** hexes that can be zoned at all — land, minus the lakes in it */
	landHexes: number
	/** hexes DESIGNATED for each use — what the law apportions. A hex counts
	 * where it is zoned, whether or not anything stands on it yet. */
	zonedLiving: number
	zonedWorks: number
	zonedReserve: number
	/** ground the settlements and works stand on */
	settledHa: number
	/** open FOOD land, on living hexes: what feeds the citizens */
	permacultureHa: number
	/** open INDUSTRIAL crop land, on works hexes: what feeds the factories */
	cropHa: number
	/** untouched land */
	reserveHa: number
	/** people per km² across every hex that has been claimed */
	densityPerKm2: number
}

/** An island with nothing on it — what the HUD reads before a world exists. */
export const EMPTY_STATS: WorldStats = {
	citizens: 0,
	settlements: 0,
	works: 0,
	landHexes: 0,
	zonedLiving: 0,
	zonedWorks: 0,
	zonedReserve: 0,
	settledHa: 0,
	permacultureHa: 0,
	cropHa: 0,
	reserveHa: 0,
	densityPerKm2: 0
}

export interface WorldApi {
	group: THREE.Group
	/** The hex under a world-space point, for picking. */
	tileAt(point: THREE.Vector3): HexTile | null
	/** Frees what this world owns — never the shared decoration pool. */
	dispose(): void
	/** Builds a settlement level, or a works, on a hex — a hex carries one. */
	placeBuilding(tile: HexTile, kind: PlacedKind): void
	/** Removes the building and lets nature grow back over the clearing. */
	removeBuilding(tile: HexTile): void
	buildingAt(tile: HexTile): PlacedKind | null
	/** Everyone housed across every settlement standing on the island. */
	population(): number
	/** What has been built across the island, in people and hectares. */
	stats(): WorldStats
	/** Every buildable hex, for span selection. */
	landTiles(): readonly HexTile[]
	/** Designates hexes for a use. Zoning is a decision, not a building — it
	 * outlives whatever stands on the hex, and nothing enforces it. */
	setZone(tiles: readonly HexTile[], zone: Zone): void
	zoneAt(tile: HexTile): Zone
	/** Shows or hides the colour wash that makes the zoning readable. */
	showZones(on: boolean): void
	/** Re-picks each block's detail for where the eye now is. Call per frame —
	 * it walks a list of chunks and touches only the ones that changed tier. */
	updateLod(eye: THREE.Vector3): void
}

/* ---------------------------------------------------------------------------
 * Chunks — the unit of culling, instancing and detail.
 *
 * A ten-times island is far more world than a camera ever looks at. Cutting it
 * into blocks of hexes buys three things from the one change:
 *
 *   · each block frustum-culls on its own, so what is behind you costs nothing
 *   · each block draws ALL its settlements of a kind in one call, not two a hex
 *   · each block picks its own detail from how far off it is
 *
 * Without them a full island submits every triangle it owns, every frame,
 * whether or not any of it is on screen — which is exactly what stopped the
 * old world from growing.
 * ------------------------------------------------------------------------- */

/**
 * Hexes to a side of a chunk.
 *
 * This is a straight trade: smaller chunks cull more precisely, larger ones
 * put fewer objects in the scene. Objects turned out to cost far more — the
 * renderer walks every one of them each frame whether or not it draws, so
 * eight-hex chunks over a ten-thousand-hex island buried the frame in eight
 * thousand mostly-invisible meshes. Sixteen is where the two stop fighting.
 */
const CHUNK = 16

/** How far a chunk can be, in world units, before it drops a tier. */
const LOD_NEAR = 34
const LOD_MID = 96

/** How much of a chunk's nature still stands at near / mid / far. A prefix of
 * a shuffled instance list is a uniform sample of it, so thinning is one
 * assignment to `count` — no matrices are rewritten. */
const DECO_SHARE = [1, 0.3, 0.045]

type Tier = 0 | 1 | 2

/**
 * What a hex is FOR — designated, not built.
 *
 * Zoning is a decision made before a thing stands, and it survives the thing
 * being cleared. A hex zoned WORKS with nothing on it is still industrial
 * land; a hex zoned RESERVE is land the city has promised not to take. Every
 * hex starts RESERVE, because the default state of ground is that nobody has
 * claimed it.
 */
export type Zone = 'RESERVE' | 'WORKS' | 'LIVING'

export const ZONE_COLORS: Record<Zone, string> = {
	RESERVE: '#5f9e5a',
	WORKS: '#d59b3c',
	LIVING: '#e8776a'
}

/** The flat cap laid over a hex to colour it, built once for all of them. */
let zoneCapGeometry: THREE.BufferGeometry | null = null
function zoneCap(): THREE.BufferGeometry {
	if (zoneCapGeometry) return zoneCapGeometry
	const r = HEX_RADIUS - BEVEL
	const pts: number[] = []
	for (let i = 0; i < 6; i++) {
		const a0 = (Math.PI / 3) * i
		const a1 = (Math.PI / 3) * (i + 1)
		pts.push(0, 0, 0, Math.cos(a1) * r, 0, Math.sin(a1) * r, Math.cos(a0) * r, 0, Math.sin(a0) * r)
	}
	const geo = new THREE.BufferGeometry()
	geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
	const normals = new Float32Array(pts.length)
	for (let i = 1; i < normals.length; i += 3) normals[i] = 1
	geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
	zoneCapGeometry = geo
	return geo
}

/** The matrix a decoration wears while a settlement stands on top of it. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)

/**
 * One instanced draw of a shared geometry, with slots handed to hexes and
 * taken back when they clear. A freed slot is filled from the end, so the live
 * range stays dense and `count` never draws holes.
 */
class SlotPool {
	readonly mesh: THREE.InstancedMesh
	private readonly owners: string[] = []
	private static readonly scratch = new THREE.Matrix4()

	constructor(
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		capacity: number,
		bounds: THREE.Sphere
	) {
		this.mesh = new THREE.InstancedMesh(geo, mat, capacity)
		this.mesh.count = 0
		// an instanced mesh has no geometry-wide bounds three can trust, so it
		// gets the chunk's — fixed, and true however the instances churn
		this.mesh.boundingSphere = bounds
	}

	claim(owner: string, m: THREE.Matrix4): void {
		const i = this.owners.length
		if (i >= this.mesh.instanceMatrix.count) return
		this.owners.push(owner)
		this.mesh.setMatrixAt(i, m)
		this.mesh.count = this.owners.length
		this.mesh.instanceMatrix.needsUpdate = true
	}

	release(owner: string): void {
		const i = this.owners.indexOf(owner)
		if (i < 0) return
		const last = this.owners.length - 1
		if (i !== last) {
			this.mesh.getMatrixAt(last, SlotPool.scratch)
			this.mesh.setMatrixAt(i, SlotPool.scratch)
			this.owners[i] = this.owners[last]
		}
		this.owners.pop()
		this.mesh.count = this.owners.length
		this.mesh.instanceMatrix.needsUpdate = true
	}
}

/**
 * A settlement seen from far off: one low dome per structure, at the size the
 * real one takes up, in the colour the real one averages out to.
 *
 * The hundred thousand triangles of glazing, arcades, railings and containers
 * that make a level five resolve to nothing at range — they only cost. Three
 * hundred triangles read the same from there.
 */
const impostorPool = new Map<string, THREE.BufferGeometry | null>()

function impostorFor(
	poolKey: string,
	clearings: readonly Clearing[],
	tint: THREE.Color
): THREE.BufferGeometry | null {
	const cached = impostorPool.get(poolKey)
	if (cached !== undefined) return cached

	const parts: THREE.BufferGeometry[] = []
	for (const c of clearings) {
		// camp clutter — containers, diggers, a van — is below a pixel by the
		// time a chunk goes far, so it does not get a stand-in at all
		if (c.extent < 0.09) continue
		const dome = new THREE.SphereGeometry(c.extent, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2)
		dome.scale(1, 0.78, 1)
		dome.translate(c.x, HEX_HEIGHT, c.z)
		parts.push(dome.toNonIndexed())
	}
	if (parts.length === 0) {
		impostorPool.set(poolKey, null)
		return null
	}

	const merged = mergeGeometries(parts, false)
	for (const p of parts) p.dispose()
	if (!merged) {
		impostorPool.set(poolKey, null)
		return null
	}
	const count = merged.getAttribute('position').count
	const colour = new Float32Array(count * 3)
	for (let i = 0; i < count; i++) {
		colour[i * 3] = tint.r
		colour[i * 3 + 1] = tint.g
		colour[i * 3 + 2] = tint.b
	}
	merged.setAttribute('color', new THREE.BufferAttribute(colour, 3))
	impostorPool.set(poolKey, merged)
	return merged
}

/** The average colour of a built settlement, for its stand-in to wear. */
function averageColour(meshes: readonly THREE.Mesh[]): THREE.Color {
	const out = new THREE.Color(0, 0, 0)
	let n = 0
	for (const mesh of meshes) {
		const attr = mesh.geometry.getAttribute('color')
		if (!attr) continue
		// a sample is plenty — this only decides a tint seen from 100 units out
		const step = Math.max(1, Math.floor(attr.count / 256))
		for (let i = 0; i < attr.count; i += step) {
			out.r += attr.getX(i)
			out.g += attr.getY(i)
			out.b += attr.getZ(i)
			n++
		}
	}
	return n > 0 ? out.multiplyScalar(1 / n) : new THREE.Color('#e8dcc8')
}

/** Everything a placed kind needs to be instanced: its parts, its stand-in,
 * and the ground it claims. Pooled per kind and variant, built once ever. */
interface PlacedBuild {
	parts: THREE.Mesh[]
	impostor: THREE.BufferGeometry | null
	clearings: Clearing[]
}
const placedPool = new Map<string, PlacedBuild>()

function placedVariant(kind: PlacedKind, variant: number): PlacedBuild {
	const poolKey = `${kind}#${variant}`
	const cached = placedPool.get(poolKey)
	if (cached) return cached

	let parts: THREE.Mesh[]
	let clearings: Clearing[]
	if (isFactory(kind)) {
		parts = factoryVariant(kind, variant).children.filter(
			(c): c is THREE.Mesh => c instanceof THREE.Mesh
		)
		const spec = FACTORIES[kind]
		clearings = [{ x: 0, z: 0, r: spec.footprint, extent: spec.footprint }]
	} else {
		const built = settlementVariant(BUILDINGS[kind].level, variant)
		parts = built.object.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh)
		clearings = built.clearings
	}

	const build: PlacedBuild = {
		parts,
		impostor: impostorFor(poolKey, clearings, averageColour(parts)),
		clearings
	}
	placedPool.set(poolKey, build)
	return build
}

/** One block of the island: its ground, its nature, and whatever is built on
 * it — every piece of which draws instanced and culls as a unit. */
interface Chunk {
	/** centre and reach, for the distance that picks the tier */
	cx: number
	cz: number
	bounds: THREE.Sphere
	tiles: HexTile[]
	ground: THREE.Mesh | null
	/** nature, one mesh per biome variant present here, shuffled so a prefix
	 * of the instances is a uniform scatter across the block. They hang off a
	 * group of their own: hiding forty meshes one at a time still leaves the
	 * renderer walking all forty, hiding their PARENT skips the lot. */
	nearGroup: THREE.Group
	deco: Array<{ mesh: THREE.InstancedMesh; full: number }>
	/** the same nature seen from far off: ONE mesh per biome, a thin sample of
	 * it, all wearing the same piece. Sixteen variants of a tree are sixteen
	 * draws to say what a hundred metres away is a single green texture. */
	farGroup: THREE.Group
	/** the zone wash over this block's hexes, one instance a hex */
	zoneMesh: THREE.InstancedMesh | null
	/** live settlements: full detail and the far stand-in, kept in step */
	full: Map<string, SlotPool>
	far: Map<string, SlotPool>
	tier: Tier
}

export function buildWorld(world: HexWorld): WorldApi {
	const group = new THREE.Group()

	/**
	 * Hangs a piece of the island off the world.
	 *
	 * Nothing here ever moves: a chunk's meshes sit at the origin and its
	 * instances carry their own world positions. Left on auto, three would
	 * recompose a matrix for every one of them EVERY frame — ten thousand
	 * matrix builds a frame to arrive back at the identity, which is most of
	 * what a frame cost before any of it was drawn.
	 */
	function mount(obj: THREE.Object3D, into: THREE.Object3D = group): void {
		obj.matrixAutoUpdate = false
		obj.updateMatrix()
		into.add(obj)
	}

	/** An empty holder that never moves, for hanging a chunk's layers off. */
	function staticGroup(): THREE.Group {
		const g = new THREE.Group()
		g.matrixAutoUpdate = false
		group.add(g)
		return g
	}
	const styles = buildStyles(world)
	const shore = new THREE.Color(SHORE)
	const field = makeFieldSampler(styles, shore)

	const land = world.tiles.filter((t) => t.kind === 'LAND')
	/** what the zoning law can actually apportion — the lakes are not it */
	const zonable = land.filter(canBuildOnTile).length
	const landSet = new Set(land.map((t) => key(t.q, t.r)))
	const isSea = (q: number, r: number) => !landSet.has(key(q, r))
	const tileByKey = new Map(land.map((t) => [key(t.q, t.r), t]))

	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		roughness: 0.9,
		metalness: 0
	})

	// --- cut the island into blocks --------------------------------------
	const chunkKey = (t: HexTile) => `${Math.floor(t.q / CHUNK)},${Math.floor(t.r / CHUNK)}`
	const grouped = new Map<string, HexTile[]>()
	for (const tile of land) {
		const k = chunkKey(tile)
		const list = grouped.get(k)
		if (list) list.push(tile)
		else grouped.set(k, [tile])
	}

	const chunks: Chunk[] = []
	const chunkOf = new Map<string, Chunk>()

	for (const tiles of grouped.values()) {
		let cx = 0
		let cz = 0
		for (const t of tiles) {
			cx += t.x
			cz += t.z
		}
		cx /= tiles.length
		cz /= tiles.length
		let reach = 0
		for (const t of tiles) reach = Math.max(reach, Math.hypot(t.x - cx, t.z - cz))
		// the reach covers the hexes; the padding covers what stands on them
		const bounds = new THREE.Sphere(new THREE.Vector3(cx, HEX_HEIGHT, cz), reach + 2.4)

		const chunk: Chunk = {
			cx,
			cz,
			bounds,
			tiles,
			ground: null,
			nearGroup: staticGroup(),
			deco: [],
			farGroup: staticGroup(),
			zoneMesh: null,
			full: new Map(),
			far: new Map(),
			tier: 0
		}
		chunks.push(chunk)
		for (const t of tiles) chunkOf.set(key(t.q, t.r), chunk)
	}

	const __ground0 = performance.now()
	// --- the ground, one merged mesh per block ---------------------------
	for (const chunk of chunks) {
		const parts: THREE.BufferGeometry[] = []
		for (const tile of chunk.tiles) {
			const rng = makeRng(tile.seed)
			parts.push(buildBaseGeo(tile, rng, field), buildTopDiscGeo(tile, rng, field))
			const skirt = buildSkirtGeo(tile, rng, field, isSea)
			if (skirt) parts.push(skirt)
		}
		const merged = mergeGeometries(parts, false)
		for (const p of parts) p.dispose()
		if (!merged) continue
		const mesh = new THREE.Mesh(merged, material)
		// flat ground never casts: keeping it out of the shadow pass is the
		// difference between one draw pass and two over the whole island
		mesh.castShadow = false
		mesh.receiveShadow = true
		chunk.ground = mesh
		mount(mesh)
	}

	const __nature0 = performance.now()
	// --- the zone wash: one flat cap a hex, coloured by what it is FOR -----
	const zones = new Map<string, Zone>()
	const zoneSlot = new Map<
		string,
		{ mesh: THREE.InstancedMesh; index: number; x: number; z: number }
	>()
	// the wash has to win against a green island under a green scatter, so it
	// is strong enough to read as a decision rather than a tint
	const zoneMaterial = new THREE.MeshBasicMaterial({
		transparent: true,
		opacity: 0.72,
		depthWrite: false
	})
	const zoneScratch = new THREE.Matrix4()
	const zoneColor = new THREE.Color()

	for (const chunk of chunks) {
		const mesh = new THREE.InstancedMesh(zoneCap(), zoneMaterial, chunk.tiles.length)
		mesh.boundingSphere = chunk.bounds
		mesh.castShadow = false
		mesh.receiveShadow = false
		// the wash is a reading of the map, not part of it: off until asked for
		mesh.visible = false
		mesh.renderOrder = 2
		for (const [i, tile] of chunk.tiles.entries()) {
			// reserve is the default state of ground, so it wears no paint: the
			// wash shows DECISIONS, and green-on-green showed nothing at all
			mesh.setMatrixAt(i, HIDDEN)
			mesh.setColorAt(i, zoneColor.set(ZONE_COLORS.RESERVE))
			zoneSlot.set(key(tile.q, tile.r), { mesh, index: i, x: tile.x, z: tile.z })
		}
		mesh.instanceMatrix.needsUpdate = true
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
		chunk.zoneMesh = mesh
		mount(mesh)
	}

	/** Paints a hex's cap to match what it is designated for. */
	function paintZone(tile: HexTile, zone: Zone): void {
		const slot = zoneSlot.get(key(tile.q, tile.r))
		if (!slot) return
		if (zone === 'RESERVE') {
			slot.mesh.setMatrixAt(slot.index, HIDDEN)
		} else {
			zoneScratch.makeTranslation(slot.x, HEX_HEIGHT + 0.02, slot.z)
			slot.mesh.setMatrixAt(slot.index, zoneScratch)
			slot.mesh.setColorAt(slot.index, zoneColor.set(ZONE_COLORS[zone]))
			if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true
		}
		slot.mesh.instanceMatrix.needsUpdate = true
	}

	// --- the nature, instanced per block and biome variant ----------------
	// Every piece of a variant within a block draws in one call, and the block
	// culls as a unit. Each instance is remembered against its hex so a hex can
	// be re-dressed around a settlement without rebuilding a thing.
	interface InstanceRef {
		mesh: THREE.InstancedMesh
		index: number
		placement: DecoPlacement
	}
	const tileInstances = new Map<string, InstanceRef[]>()

	for (const chunk of chunks) {
		const buckets = new Map<string, Array<{ tile: HexTile; placement: DecoPlacement }>>()
		for (const tile of chunk.tiles) {
			tileInstances.set(key(tile.q, tile.r), [])
			for (const placement of planTileDeco(tile, makeRng(tile.seed ^ 0xdec0))) {
				const bucket = `${placement.biome}#${placement.variant}`
				const list = buckets.get(bucket)
				if (list) list.push({ tile, placement })
				else buckets.set(bucket, [{ tile, placement }])
			}
		}

		const farByBiome = new Map<BiomeId, Array<{ tile: HexTile; placement: DecoPlacement }>>()

		for (const [bucket, entries] of buckets) {
			// shuffled once, deterministically: thinning a distant block is then
			// just a smaller `count`, and what survives is scattered rather than
			// clumped into whichever hexes happened to be planned first
			const shuffle = makeRng(0x5caff0 + entries.length * 131)
			for (let i = entries.length - 1; i > 0; i--) {
				const j = shuffle.int(0, i)
				;[entries[i], entries[j]] = [entries[j], entries[i]]
			}

			const [biome, variant] = bucket.split('#')
			// the prefix of the shuffle is already a fair sample of the block
			const sampled = entries.slice(0, Math.ceil(entries.length * DECO_SHARE[2]))
			const far = farByBiome.get(biome as BiomeId)
			if (far) far.push(...sampled)
			else farByBiome.set(biome as BiomeId, sampled)
			const geo = biomeVariants(biome as BiomeId)[Number(variant)]
			const mesh = new THREE.InstancedMesh(geo, material, entries.length)
			mesh.name = bucket
			mesh.castShadow = true
			mesh.receiveShadow = true
			mesh.boundingSphere = chunk.bounds
			for (const [i, { tile, placement }] of entries.entries()) {
				mesh.setMatrixAt(i, placementMatrix(placement))
				tileInstances.get(key(tile.q, tile.r))!.push({ mesh, index: i, placement })
			}
			mesh.instanceMatrix.needsUpdate = true
			chunk.deco.push({ mesh, full: entries.length })
			mount(mesh, chunk.nearGroup)
		}

		for (const [biome, entries] of farByBiome) {
			if (entries.length === 0) continue
			const mesh = new THREE.InstancedMesh(biomeVariants(biome)[0], material, entries.length)
			mesh.name = `${biome}#far`
			// nothing this small casts a shadow anyone can resolve
			mesh.castShadow = false
			mesh.receiveShadow = true
			mesh.boundingSphere = chunk.bounds
			for (const [i, { tile, placement }] of entries.entries()) {
				mesh.setMatrixAt(i, placementMatrix(placement))
				tileInstances.get(key(tile.q, tile.r))!.push({ mesh, index: i, placement })
			}
			mesh.instanceMatrix.needsUpdate = true
			mount(mesh, chunk.farGroup)
		}
	}

	if (import.meta.env.DEV) {
		console.log(
			`[perf] ground ${(__nature0 - __ground0) | 0} ms · nature ${(performance.now() - __nature0) | 0} ms · ${chunks.length} chunks`
		)
	}

	for (const chunk of chunks) chunk.farGroup.visible = false

	const buildings = new Map<string, { kind: PlacedKind; variant: number }>()

	/** Hides or restores a hex's pieces so a settlement has room to stand. */
	function setDeco(tile: HexTile, clearings: readonly Clearing[]): void {
		const refs = tileInstances.get(key(tile.q, tile.r))
		if (!refs) return
		const touched = new Set<THREE.InstancedMesh>()
		for (const ref of refs) {
			const { px, pz } = ref.placement
			const buried = clearings.some((c) => Math.hypot(px - c.x, pz - c.z) < c.r)
			ref.mesh.setMatrixAt(ref.index, buried ? HIDDEN : placementMatrix(ref.placement))
			touched.add(ref.mesh)
		}
		for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true
	}

	/** Finds, or opens, the instanced draw a build's part belongs to here. */
	function poolFor(
		chunk: Chunk,
		into: Map<string, SlotPool>,
		poolKey: string,
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		castShadow: boolean
	): SlotPool {
		const hit = into.get(poolKey)
		if (hit) return hit
		// a hex carries at most one building, so the block can never need more
		// slots than it has hexes
		const pool = new SlotPool(geo, mat, chunk.tiles.length, chunk.bounds)
		pool.mesh.castShadow = castShadow
		pool.mesh.receiveShadow = true
		pool.mesh.visible = into === chunk.full ? chunk.tier === 0 : chunk.tier !== 0
		into.set(poolKey, pool)
		mount(pool.mesh)
		return pool
	}

	const place = new THREE.Matrix4()

	function removeBuilding(tile: HexTile): void {
		const k = key(tile.q, tile.r)
		const standing = buildings.get(k)
		if (!standing) return
		const chunk = chunkOf.get(k)
		if (chunk) {
			for (const pool of chunk.full.values()) pool.release(k)
			for (const pool of chunk.far.values()) pool.release(k)
		}
		buildings.delete(k)
		setDeco(tile, [])
	}

	/** Gives every block the detail its distance from the eye deserves. */
	function updateLod(eye: THREE.Vector3): void {
		const ex = eye.x - group.position.x
		const ez = eye.z - group.position.z
		for (const chunk of chunks) {
			const d = Math.hypot(ex - chunk.cx, ez - chunk.cz)
			const tier: Tier = d < LOD_NEAR ? 0 : d < LOD_MID ? 1 : 2
			if (tier === chunk.tier) continue
			chunk.tier = tier

			// one flag a layer, not one a mesh: the renderer walks past a hidden
			// group without descending, and a block holds forty of them
			chunk.nearGroup.visible = tier !== 2
			chunk.farGroup.visible = tier === 2
			const share = DECO_SHARE[tier]
			if (tier !== 2) {
				for (const { mesh, full } of chunk.deco) {
					mesh.count = share >= 1 ? full : Math.ceil(full * share)
					// a shadow no one can resolve is a second pass over the same
					// triangles for nothing
					mesh.castShadow = tier === 0
				}
			}
			for (const pool of chunk.full.values()) pool.mesh.visible = tier === 0
			for (const pool of chunk.far.values()) pool.mesh.visible = tier !== 0
		}
	}

	return {
		group,
		updateLod,
		dispose(): void {
			// the instanced meshes draw POOLED geometry shared with every other
			// world; disposing it here would throw away the variant library and
			// force it back onto the GPU with the next island. A chunk's layers
			// hang off groups now, so this has to go all the way down
			group.traverse((child) => {
				if (child instanceof THREE.InstancedMesh) child.dispose()
				else if (child instanceof THREE.Mesh) child.geometry.dispose()
			})
			group.clear()
			material.dispose()
			zoneMaterial.dispose()
		},
		tileAt(point: THREE.Vector3): HexTile | null {
			// the ground draws in chunks, so a hit is located by geometry:
			// world position -> axial coordinates -> the hex that contains it
			const local = point.clone().sub(group.position)
			const qf = local.x / 1.5
			const [q, r] = axialRound(qf, local.z / Math.sqrt(3) - qf / 2)
			return tileByKey.get(key(q, r)) ?? null
		},
		buildingAt: (tile) => buildings.get(key(tile.q, tile.r))?.kind ?? null,
		landTiles: () => land,
		setZone(tiles, zone) {
			for (const tile of tiles) {
				if (!canBuildOnTile(tile)) continue
				zones.set(key(tile.q, tile.r), zone)
				paintZone(tile, zone)
			}
		},
		zoneAt: (tile) => zones.get(key(tile.q, tile.r)) ?? 'RESERVE',
		showZones(on) {
			for (const chunk of chunks) if (chunk.zoneMesh) chunk.zoneMesh.visible = on
		},
		stats(): WorldStats {
			let citizens = 0
			let settlements = 0
			let works = 0
			let settledHa = 0
			let permacultureHa = 0
			let cropHa = 0
			for (const { kind } of buildings.values()) {
				if (isFactory(kind)) {
					works++
					const dome = (Math.PI * (FACTORIES[kind].diameterM / 2) ** 2) / 10_000
					settledHa += dome
					// the yard around a works is not idle and it is not food: it
					// is the crop the dome runs on
					cropHa += Math.max(0, HEX_HA - dome)
				} else {
					settlements++
					// the whole cluster disc counts as settled — the gaps between
					// domes are squares and paths, not farmland
					settledHa += CLUSTER_HA
					permacultureHa += Math.max(0, HEX_HA - CLUSTER_HA)
					citizens += settlementCapacity(BUILDINGS[kind].level)
				}
			}
			let zonedLiving = 0
			let zonedWorks = 0
			for (const zone of zones.values()) {
				if (zone === 'LIVING') zonedLiving++
				else if (zone === 'WORKS') zonedWorks++
			}
			const claimed = settlements + works
			// a lake is land, but it is not land anyone can zone: leaving it in
			// the denominator would quietly move every share off its target
			return {
				citizens,
				settlements,
				works,
				landHexes: zonable,
				zonedLiving,
				zonedWorks,
				zonedReserve: Math.max(0, zonable - zonedLiving - zonedWorks),
				settledHa,
				permacultureHa,
				cropHa,
				reserveHa: Math.max(0, zonable - zonedLiving - zonedWorks) * HEX_HA,
				densityPerKm2: claimed > 0 ? citizens / ((claimed * HEX_HA) / 100) : 0
			}
		},
		population(): number {
			// works house nobody; every settlement counts what actually stands
			// on it, which settlementCapacity already resolves from the level
			let total = 0
			for (const { kind } of buildings.values()) {
				if (!isFactory(kind)) total += settlementCapacity(BUILDINGS[kind].level)
			}
			return total
		},
		removeBuilding,
		placeBuilding(tile, kind) {
			if (!canBuildOnTile(tile)) return
			removeBuilding(tile)
			const k = key(tile.q, tile.r)
			const chunk = chunkOf.get(k)
			if (!chunk) return

			const variant = Math.abs(tile.seed) % SETTLEMENT_VARIANTS
			const build = placedVariant(kind, variant)
			place.makeTranslation(tile.x, 0, tile.z)

			for (const [i, part] of build.parts.entries()) {
				poolFor(
					chunk,
					chunk.full,
					`${kind}#${variant}#${i}`,
					part.geometry,
					part.material as THREE.Material,
					part.castShadow
				).claim(k, place)
			}
			if (build.impostor) {
				poolFor(chunk, chunk.far, `${kind}#${variant}`, build.impostor, material, true).claim(
					k,
					place
				)
			}

			buildings.set(k, { kind, variant })
			// founding something IS a zoning decision: a hex you build a works
			// on is industrial land from that moment, and the law should not
			// need you to say so twice
			const zone: Zone = isFactory(kind) ? 'WORKS' : 'LIVING'
			zones.set(k, zone)
			paintZone(tile, zone)
			// nature keeps out of the ground the settlement claims
			setDeco(tile, build.clearings)
		}
	}
}

/** Rounds fractional axial coordinates to the hex that contains them. */
function axialRound(qf: number, rf: number): [number, number] {
	const yf = -qf - rf
	let x = Math.round(qf)
	let y = Math.round(yf)
	let z = Math.round(rf)
	const dx = Math.abs(x - qf)
	const dy = Math.abs(y - yf)
	const dz = Math.abs(z - rf)
	if (dx > dy && dx > dz) x = -y - z
	else if (dy > dz) y = -x - z
	else z = -x - y
	return [x, z]
}

/**
 * Removes a placed structure from the scene. It disposes NOTHING: every mesh
 * points at pooled geometry and materials shared with every other hex, so
 * freeing them here would blank the next settlement placed.
 */
function disposeTree(root: THREE.Object3D): void {
	root.clear()
}
