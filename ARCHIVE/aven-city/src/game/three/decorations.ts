/**
 * Low-poly clay decorations — trees, rocks, tufts, pebbles.
 *
 * Everything is built from primitive geometry with flat shading and small
 * seeded jitter in scale, rotation and hue, so each instance reads as
 * hand-modelled clay rather than a stamped asset.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Rng } from '../rng'

function clay(color: string | THREE.Color): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.92,
		metalness: 0,
		flatShading: false
	})
}

/** Small random hue/lightness shift so no two pieces share an exact color. */
function jitterColor(rng: Rng, hex: string, h = 0.015, s = 0.08, l = 0.05): THREE.Color {
	const c = new THREE.Color(hex)
	c.offsetHSL(rng.jitter(0, h), rng.jitter(0, s), rng.jitter(0, l))
	return c
}

function shadow(m: THREE.Mesh): THREE.Mesh {
	m.castShadow = true
	m.receiveShadow = true
	return m
}

const TRUNK = '#b08155'

export function pine(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const s = rng.range(0.75, 1.25)
	const trunk = shadow(
		new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.22, 8), clay(jitterColor(rng, TRUNK)))
	)
	trunk.position.y = 0.11
	g.add(trunk)
	const tiers = rng.int(2, 3)
	const green = jitterColor(rng, '#3f8a63')
	for (let i = 0; i < tiers; i++) {
		const radius = 0.3 - i * 0.075
		const cone = shadow(
			new THREE.Mesh(
				new THREE.ConeGeometry(radius, 0.34, 10),
				clay(green.clone().offsetHSL(0, 0, i * 0.03))
			)
		)
		cone.position.y = 0.3 + i * 0.22
		g.add(cone)
	}
	g.scale.setScalar(s)
	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

export function blobTree(rng: Rng, color = '#7fbf77'): THREE.Group {
	const g = new THREE.Group()
	const s = rng.range(0.7, 1.2)
	const trunk = shadow(
		new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.3, 8), clay(jitterColor(rng, TRUNK)))
	)
	trunk.position.y = 0.15
	g.add(trunk)
	const crown = shadow(
		new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), clay(jitterColor(rng, color)))
	)
	crown.position.y = 0.5
	crown.scale.set(1, rng.range(0.85, 1.1), 1)
	crown.rotation.set(rng.next(), rng.next(), rng.next())
	g.add(crown)
	if (rng.chance(0.4)) {
		const side = shadow(
			new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1), clay(jitterColor(rng, color)))
		)
		const a = rng.range(0, Math.PI * 2)
		side.position.set(Math.cos(a) * 0.22, 0.38, Math.sin(a) * 0.22)
		g.add(side)
	}
	g.scale.setScalar(s)
	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** The pink puff trees from the reference islands — DUNES signature. */
export function puffTree(rng: Rng): THREE.Group {
	return blobTree(rng, rng.chance(0.5) ? '#f2b8c6' : '#f4c9a8')
}

/** Low bush — a trunkless crown hugging the ground. Forest filler. */
export function bush(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const green = jitterColor(rng, rng.chance(0.5) ? '#6fb468' : '#8cc97f')
	const main = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), clay(green)))
	main.position.y = 0.1
	main.scale.set(1, 0.75, 1)
	main.rotation.y = rng.range(0, Math.PI * 2)
	g.add(main)
	if (rng.chance(0.5)) {
		const side = shadow(
			new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), clay(jitterColor(rng, '#7fbf77')))
		)
		const a = rng.range(0, Math.PI * 2)
		side.position.set(Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16)
		side.scale.y = 0.7
		g.add(side)
	}
	g.scale.setScalar(rng.range(0.8, 1.3))
	return g
}

export function rock(rng: Rng, scale = 1): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(1, 2)
	for (let i = 0; i < n; i++) {
		const r = shadow(
			new THREE.Mesh(
				new THREE.DodecahedronGeometry(rng.range(0.12, 0.24) * scale, 1),
				clay(jitterColor(rng, '#a8a094', 0.005, 0.02, 0.06))
			)
		)
		r.position.set(rng.jitter(0, 0.12), 0.06 * scale, rng.jitter(0, 0.12))
		r.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3)
		r.scale.y = rng.range(0.6, 0.9)
		g.add(r)
	}
	return g
}

/** Big mountain formation — 1-2 faceted peaks. */
export function peak(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const main = shadow(
		new THREE.Mesh(
			new THREE.ConeGeometry(rng.range(0.34, 0.46), rng.range(0.7, 1.05), 8),
			clay(jitterColor(rng, '#989184', 0.004, 0.02, 0.05))
		)
	)
	main.position.y = 0.32
	main.rotation.y = rng.range(0, Math.PI * 2)
	g.add(main)
	if (rng.chance(0.7)) {
		const side = shadow(
			new THREE.Mesh(
				new THREE.ConeGeometry(rng.range(0.2, 0.3), rng.range(0.4, 0.6), 8),
				clay(jitterColor(rng, '#a49c8f', 0.004, 0.02, 0.05))
			)
		)
		const a = rng.range(0, Math.PI * 2)
		side.position.set(Math.cos(a) * 0.34, 0.2, Math.sin(a) * 0.34)
		side.rotation.y = rng.range(0, Math.PI * 2)
		g.add(side)
	}
	return g
}

/** Grass tuft — a few tiny cones. */
export function tuft(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(2, 4)
	const green = jitterColor(rng, '#9ccc70', 0.02, 0.1, 0.06)
	for (let i = 0; i < n; i++) {
		const blade = shadow(
			new THREE.Mesh(new THREE.ConeGeometry(0.035, rng.range(0.1, 0.18), 7), clay(green))
		)
		blade.position.set(rng.jitter(0, 0.07), 0.06, rng.jitter(0, 0.07))
		blade.rotation.z = rng.jitter(0, 0.25)
		g.add(blade)
	}
	return g
}

/** Tiny flower — stem + colored head. */
export function flower(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const head = shadow(
		new THREE.Mesh(
			new THREE.IcosahedronGeometry(0.045, 1),
			clay(rng.pick(['#f2b8c6', '#f5d76e', '#ffffff', '#f09a8b']))
		)
	)
	head.position.y = 0.12
	g.add(head)
	const stem = shadow(
		new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 4), clay('#7fae62'))
	)
	stem.position.y = 0.05
	g.add(stem)
	return g
}

export function pebble(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const p = shadow(
		new THREE.Mesh(
			new THREE.IcosahedronGeometry(rng.range(0.05, 0.1), 1),
			clay(jitterColor(rng, '#b9b2a6', 0.004, 0.02, 0.06))
		)
	)
	p.scale.y = 0.55
	p.rotation.y = rng.range(0, Math.PI * 2)
	p.position.y = 0.03
	g.add(p)
	return g
}

/** Clay sheep — MEADOW signature. A woolly capsule with a dark head. */
export function sheep(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const body = shadow(
		new THREE.Mesh(
			new THREE.CapsuleGeometry(0.09, 0.12, 4, 10),
			clay(jitterColor(rng, '#f7f3ea', 0.002, 0.01, 0.03))
		)
	)
	body.rotation.z = Math.PI / 2
	body.position.y = 0.11
	g.add(body)
	const head = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), clay('#4a423b')))
	head.position.set(0.13, 0.13, 0)
	g.add(head)
	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.85, 1.15))
	return g
}

/** Berry bush — GROVE signature: a bush studded with bright berries. */
export function berryBush(rng: Rng): THREE.Group {
	const g = bush(rng)
	const berryColor = rng.pick(['#e05e4a', '#f09a8b', '#f5d76e'])
	const n = rng.int(3, 5)
	for (let i = 0; i < n; i++) {
		const b = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), clay(berryColor)))
		const a = rng.range(0, Math.PI * 2)
		const el = rng.range(0.2, 1.1)
		b.position.set(
			Math.cos(a) * 0.13 * Math.cos(el),
			0.1 + 0.1 * Math.sin(el),
			Math.sin(a) * 0.13 * Math.cos(el)
		)
		g.add(b)
	}
	return g
}

/** Cairn — MOUNTAIN signature: hand-stacked stones. */
export function cairn(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(3, 4)
	let y = 0.03
	for (let i = 0; i < n; i++) {
		const r = 0.11 - i * 0.024
		const stone = shadow(
			new THREE.Mesh(
				new THREE.SphereGeometry(r, 7, 5),
				clay(jitterColor(rng, '#a8a094', 0.004, 0.02, 0.05))
			)
		)
		stone.scale.y = 0.55
		stone.position.set(rng.jitter(0, 0.012), y, rng.jitter(0, 0.012))
		stone.rotation.y = rng.range(0, Math.PI)
		g.add(stone)
		y += r * 0.9
	}
	return g
}

/** Ore rock — ORECLIFF signature: dark stone with gold nuggets. */
export function oreRock(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const base = shadow(
		new THREE.Mesh(
			new THREE.DodecahedronGeometry(rng.range(0.14, 0.22), 1),
			clay(jitterColor(rng, '#6e675e', 0.004, 0.02, 0.04))
		)
	)
	base.position.y = 0.08
	base.scale.y = 0.75
	base.rotation.set(rng.next(), rng.next() * 3, rng.next())
	g.add(base)
	const n = rng.int(2, 4)
	for (let i = 0; i < n; i++) {
		const nug = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0), clay('#e3b34e')))
		const a = rng.range(0, Math.PI * 2)
		nug.position.set(Math.cos(a) * 0.12, rng.range(0.05, 0.16), Math.sin(a) * 0.12)
		g.add(nug)
	}
	return g
}

/** Amber crystal shards — ORECLIFF accent. */
export function crystal(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(2, 3)
	for (let i = 0; i < n; i++) {
		const h = rng.range(0.12, 0.24)
		const c = shadow(
			new THREE.Mesh(
				new THREE.OctahedronGeometry(0.05, 0),
				clay(rng.pick(['#f2cd74', '#f5b85c', '#e8d9a0']))
			)
		)
		c.scale.set(0.7, h / 0.05, 0.7)
		c.position.set(rng.jitter(0, 0.09), h * 0.5, rng.jitter(0, 0.09))
		c.rotation.y = rng.range(0, Math.PI)
		c.rotation.z = rng.jitter(0, 0.2)
		g.add(c)
	}
	return g
}

/** Palm — DUNES signature: curved trunk, fan of leaves, coconuts. */
export function palm(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const lean = rng.jitter(0, 0.22)
	const segs = 3
	let x = 0
	let y = 0
	for (let i = 0; i < segs; i++) {
		const seg = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.035 - i * 0.005, 0.045 - i * 0.005, 0.18, 7),
				clay(jitterColor(rng, '#b08a5e'))
			)
		)
		seg.position.set(x, y + 0.09, 0)
		seg.rotation.z = lean * (i + 1) * 0.6
		g.add(seg)
		x += Math.sin(lean * (i + 1) * 0.6) * 0.16
		y += Math.cos(lean * (i + 1) * 0.6) * 0.165
	}
	const crown = new THREE.Group()
	crown.position.set(x, y + 0.02, 0)
	const leaves = rng.int(5, 7)
	const leafColor = jitterColor(rng, '#5aa86e')
	for (let i = 0; i < leaves; i++) {
		const leaf = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.2, 3, 6), clay(leafColor)))
		leaf.scale.set(1, 1, 0.4)
		const a = (i / leaves) * Math.PI * 2 + rng.jitter(0, 0.2)
		leaf.position.set(Math.cos(a) * 0.11, 0.02, Math.sin(a) * 0.11)
		leaf.rotation.y = -a
		leaf.rotation.z = Math.PI / 2 - 0.55 + rng.jitter(0, 0.12)
		crown.add(leaf)
	}
	for (let i = 0; i < 2; i++) {
		const nut = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.032, 7, 5), clay('#8a6844')))
		const a = rng.range(0, Math.PI * 2)
		nut.position.set(Math.cos(a) * 0.05, -0.02, Math.sin(a) * 0.05)
		crown.add(nut)
	}
	g.add(crown)
	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.9, 1.35))
	return g
}

/** Sunflower — SUNPLAINS signature: golden disc chasing the sun. */
export function sunflower(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const h = rng.range(0.22, 0.34)
	const stem = shadow(
		new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, h, 5), clay('#7fae62'))
	)
	stem.position.y = h / 2
	g.add(stem)
	const head = new THREE.Group()
	head.position.y = h
	const petals = shadow(
		new THREE.Mesh(
			new THREE.CylinderGeometry(0.085, 0.085, 0.018, 12),
			clay(jitterColor(rng, '#f5c95c', 0.008, 0.05, 0.03))
		)
	)
	head.add(petals)
	const core = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), clay('#8a6432')))
	core.scale.y = 0.4
	core.position.y = 0.012
	head.add(core)
	head.rotation.x = rng.range(0.25, 0.5)
	head.rotation.y = rng.range(0, Math.PI * 2)
	g.add(head)
	g.scale.setScalar(rng.range(0.85, 1.2))
	return g
}

/** Cattail reeds — LAKE / wet edges: tall stems with brown heads. */
export function reeds(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(4, 7)
	for (let i = 0; i < n; i++) {
		const h = rng.range(0.24, 0.42)
		const stem = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.01, 0.014, h, 4),
				facet(jitterColor(rng, '#6fae53', 0.012, 0.06, 0.05))
			)
		)
		const px = rng.jitter(0, 0.09)
		const pz = rng.jitter(0, 0.09)
		stem.position.set(px, h / 2, pz)
		stem.rotation.z = rng.jitter(0, 0.12)
		g.add(stem)
		if (rng.chance(0.7)) {
			const head = shadow(
				new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.07, 2, 5), facet('#8a5a2e'))
			)
			head.position.set(px + stem.rotation.z * -h * 0.5, h + 0.03, pz)
			g.add(head)
		}
	}
	return g
}

/** Lily pad — LAKE surface: floating disc, sometimes flowering. */
export function lilyPad(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(1, 3)
	for (let i = 0; i < n; i++) {
		const pr = rng.range(0.09, 0.16)
		const pad = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(pr, pr, 0.014, 7),
				facet(jitterColor(rng, '#4f9c50', 0.012, 0.06, 0.05))
			)
		)
		pad.position.set(rng.jitter(0, 0.14), 0.008, rng.jitter(0, 0.14))
		g.add(pad)
		if (rng.chance(0.35)) {
			const bloom = shadow(
				new THREE.Mesh(
					new THREE.IcosahedronGeometry(0.04, 0),
					facet(rng.chance(0.6) ? '#f5f0e6' : '#f2b8c6')
				)
			)
			bloom.position.copy(pad.position).setY(0.04)
			g.add(bloom)
		}
	}
	return g
}

/** Wheat/flax sheaf — FIBERFIELD signature: a leaning golden bundle. */
export function sheaf(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(5, 8)
	for (let i = 0; i < n; i++) {
		const h = rng.range(0.2, 0.3)
		const straw = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.008, 0.01, h, 5),
				clay(jitterColor(rng, '#dcb84f', 0.01, 0.06, 0.05))
			)
		)
		const a = (i / n) * Math.PI * 2
		straw.position.set(Math.cos(a) * 0.045, h / 2, Math.sin(a) * 0.045)
		straw.rotation.z = Math.cos(a) * 0.22
		straw.rotation.x = -Math.sin(a) * 0.22
		g.add(straw)
	}
	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** Golden grass — tall dry tuft for FIBERFIELD / SUNPLAINS. */
export function goldTuft(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(3, 5)
	const gold = jitterColor(rng, '#d9c27f', 0.015, 0.08, 0.05)
	for (let i = 0; i < n; i++) {
		const blade = shadow(
			new THREE.Mesh(new THREE.ConeGeometry(0.028, rng.range(0.16, 0.28), 6), clay(gold))
		)
		blade.position.set(rng.jitter(0, 0.07), 0.09, rng.jitter(0, 0.07))
		blade.rotation.z = rng.jitter(0, 0.3)
		g.add(blade)
	}
	return g
}

/* ---------------------------------------------------------------------------
 * FACETED LOW-POLY toolkit — the stylised art direction (visible triangles,
 * flat shading, organically displaced silhouettes). Rolled out biome by
 * biome, starting with CLAYPIT.
 * ------------------------------------------------------------------------ */

/** Flat-shaded material — the faceted look lives or dies by this. */
function facet(color: string | THREE.Color): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.95,
		metalness: 0,
		flatShading: true
	})
}

/**
 * Organic displacement: joggle vertices by a hash of their POSITION, so
 * coincident vertices (shared face corners of non-indexed polyhedra) move
 * identically — the shape stays watertight while the silhouette crumples
 * into believable low-poly rock.
 */
function displaceGeo(geo: THREE.BufferGeometry, rng: Rng, amount: number): THREE.BufferGeometry {
	const pos = geo.getAttribute('position')
	const ox = rng.range(0, 100)
	const oz = rng.range(0, 100)
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const y = pos.getY(i)
		const z = pos.getZ(i)
		const h1 = Math.sin((x + ox) * 12.9898 + (y - oz) * 78.233 + z * 37.719) * 43758.5453
		const h2 = Math.sin((z + ox) * 26.651 + (x + oz) * 15.731 + y * 94.673) * 24634.6345
		const h3 = Math.sin((y - ox) * 61.313 + (z - oz) * 11.135 + x * 53.989) * 56445.2345
		pos.setXYZ(
			i,
			x + (h1 - Math.floor(h1) - 0.5) * amount,
			y + (h2 - Math.floor(h2) - 0.5) * amount,
			z + (h3 - Math.floor(h3) - 0.5) * amount
		)
	}
	geo.computeVertexNormals()
	return geo
}

const CLAY_TONES = ['#d99862', '#c97f4d', '#c27b45', '#b06a3e', '#a95f36']

/** Faceted terracotta boulder — CLAYPIT terrain anchor. */
export function clayBoulder(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const r = rng.range(0.55, 0.95)
	const geo = displaceGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.42)
	const b = shadow(
		new THREE.Mesh(geo, facet(jitterColor(rng, rng.pick(CLAY_TONES), 0.006, 0.04, 0.05)))
	)
	b.scale.y = rng.range(0.65, 0.9)
	b.position.y = r * 0.55
	b.rotation.y = rng.range(0, Math.PI * 2)
	g.add(b)
	if (rng.chance(0.5)) {
		const r2 = r * rng.range(0.4, 0.6)
		const s = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(r2, 1), rng, r2 * 0.4),
				facet(jitterColor(rng, rng.pick(CLAY_TONES), 0.006, 0.04, 0.05))
			)
		)
		const a = rng.range(0, Math.PI * 2)
		s.position.set(Math.cos(a) * r * 1.1, r2 * 0.5, Math.sin(a) * r * 1.1)
		s.scale.y = 0.7
		g.add(s)
	}
	return g
}

/** Terraced clay mound — stacked faceted steps, like a dig site. */
export function clayTerrace(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const tiers = rng.int(2, 3)
	let y = 0
	let r = rng.range(0.7, 1.05)
	for (let i = 0; i < tiers; i++) {
		const geo = displaceGeo(new THREE.CylinderGeometry(r * 0.82, r, 0.28, 7), rng, 0.12)
		const tier = shadow(
			new THREE.Mesh(
				geo,
				facet(jitterColor(rng, CLAY_TONES[Math.min(i + 1, 4)], 0.006, 0.04, 0.04))
			)
		)
		tier.position.y = y + 0.14
		tier.rotation.y = rng.range(0, Math.PI * 2)
		g.add(tier)
		y += 0.26
		r *= rng.range(0.62, 0.74)
	}
	return g
}

/** Raw CLAY chunks — the biome's harvestable resource, unmistakably. */
export function clayChunks(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(3, 5)
	for (let i = 0; i < n; i++) {
		const r = rng.range(0.16, 0.3)
		const geo = displaceGeo(new THREE.IcosahedronGeometry(r, 0), rng, r * 0.35)
		const chunk = shadow(
			new THREE.Mesh(
				geo,
				facet(jitterColor(rng, rng.chance(0.3) ? '#8f4a2c' : '#b35c33', 0.008, 0.05, 0.05))
			)
		)
		const a = rng.range(0, Math.PI * 2)
		const d = rng.range(0, 0.45)
		chunk.position.set(Math.cos(a) * d, r * 0.7, Math.sin(a) * d)
		chunk.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3)
		g.add(chunk)
	}
	return g
}

/** Bare dead tree — sun-scorched claypit accent (faceted, leafless). */
export function deadTree(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const col = jitterColor(rng, '#7d4630', 0.006, 0.04, 0.05)
	const h = rng.range(1.0, 1.5)
	const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.13, h, 5), facet(col)))
	trunk.position.y = h / 2
	trunk.rotation.z = rng.jitter(0, 0.1)
	g.add(trunk)
	const branches = rng.int(2, 3)
	for (let i = 0; i < branches; i++) {
		const bh = h * rng.range(0.35, 0.55)
		const br = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.06, bh, 4), facet(col)))
		const a = rng.range(0, Math.PI * 2)
		br.position.set(Math.cos(a) * 0.1, h * rng.range(0.55, 0.85), Math.sin(a) * 0.1)
		br.rotation.z = Math.cos(a) * rng.range(0.5, 0.9)
		br.rotation.x = Math.sin(a) * rng.range(0.5, 0.9)
		g.add(br)
	}
	g.scale.setScalar(rng.range(0.8, 1.2))
	return g
}

/* --- FOREST v2 (faceted) -------------------------------------------------- */

const PINE_GREENS = ['#2e6b45', '#3f8a58', '#4f9c63', '#57a86b']
const BARK = '#a8734a'

/** Tall tiered pine — the POLYGON-forest silhouette: long stub-branched
 * trunk, 5-7 jagged foliage skirts in alternating greens, a spired top. */
export function pineTall(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const h = rng.range(2.2, 3.3)
	const barkCol = jitterColor(rng, BARK, 0.008, 0.05, 0.05)

	const trunk = shadow(
		new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.1, h * 0.92, 5), facet(barkCol))
	)
	trunk.position.y = h * 0.46
	g.add(trunk)

	// stub branches poking through the canopy
	const stubs = rng.int(1, 2)
	for (let i = 0; i < stubs; i++) {
		const stub = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.012, 0.02, rng.range(0.12, 0.24), 3),
				facet(barkCol)
			)
		)
		const a = rng.range(0, Math.PI * 2)
		const sy = h * rng.range(0.25, 0.85)
		stub.position.set(Math.cos(a) * 0.09, sy, Math.sin(a) * 0.09)
		stub.rotation.z = Math.cos(a) * (1.2 + rng.jitter(0, 0.3))
		stub.rotation.x = -Math.sin(a) * (1.2 + rng.jitter(0, 0.3))
		g.add(stub)
	}

	// jagged foliage skirts
	// four or five skirts read the same as seven at the size a tree renders
	const tiers = rng.int(4, 5)
	const y0 = h * 0.34
	for (let i = 0; i < tiers; i++) {
		const t = i / (tiers - 1)
		const R = (0.72 - 0.5 * t) * rng.range(0.85, 1.15)
		const tierH = h * 0.15
		const geo = displaceGeo(new THREE.ConeGeometry(R, tierH, 6), rng, R * 0.22)
		const cone = shadow(
			new THREE.Mesh(
				geo,
				facet(jitterColor(rng, PINE_GREENS[i % PINE_GREENS.length], 0.008, 0.05, 0.04))
			)
		)
		cone.position.y = y0 + (h * 0.62 * i) / tiers + tierH * 0.4
		cone.rotation.y = rng.range(0, Math.PI * 2)
		g.add(cone)
	}
	const top = shadow(
		new THREE.Mesh(
			displaceGeo(new THREE.ConeGeometry(0.14, h * 0.16, 5), rng, 0.03),
			facet(jitterColor(rng, PINE_GREENS[3], 0.008, 0.05, 0.04))
		)
	)
	top.position.y = h * 0.98
	g.add(top)

	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.85, 1.2))
	return g
}

/** Mossy fallen log with snapped stub branches. */
export function fallenLog(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const r = rng.range(0.13, 0.2)
	const len = rng.range(0.9, 1.5)
	const barkCol = jitterColor(rng, BARK, 0.008, 0.05, 0.05)

	const log = shadow(
		new THREE.Mesh(
			displaceGeo(new THREE.CylinderGeometry(r * 0.85, r, len, 7), rng, r * 0.18),
			facet(barkCol)
		)
	)
	log.rotation.z = Math.PI / 2 + rng.jitter(0, 0.08)
	log.rotation.y = rng.range(0, Math.PI * 2)
	log.position.y = r * 0.85
	g.add(log)

	// moss blanket
	const moss = shadow(
		new THREE.Mesh(
			displaceGeo(new THREE.IcosahedronGeometry(r * 1.05, 1), rng, r * 0.3),
			facet(jitterColor(rng, '#5da24f', 0.01, 0.06, 0.05))
		)
	)
	moss.scale.set(len * 0.32, 0.35, 1)
	moss.rotation.y = log.rotation.y
	moss.position.y = r * 1.5
	g.add(moss)

	const stubs = rng.int(1, 2)
	for (let i = 0; i < stubs; i++) {
		const stub = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.015, 0.025, rng.range(0.12, 0.22), 4),
				facet(barkCol)
			)
		)
		const along = rng.range(-len * 0.35, len * 0.35)
		const dir = log.rotation.y
		stub.position.set(Math.cos(dir) * along, r * rng.range(1.2, 1.7), -Math.sin(dir) * along)
		stub.rotation.set(rng.jitter(0, 1), rng.next() * 3, rng.jitter(0, 1))
		g.add(stub)
	}
	return g
}

/** Stratified slab boulder — wide stacked layers, mossy cap chance. */
export function slabRock(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const tones = ['#6b7565', '#78826f', '#8a937f']
	const layers = rng.int(2, 4)
	let y = 0
	let R = rng.range(0.45, 0.75)
	for (let i = 0; i < layers; i++) {
		const lh = R * rng.range(0.28, 0.4)
		const geo = displaceGeo(new THREE.IcosahedronGeometry(R, 1), rng, R * 0.3)
		const slab = shadow(
			new THREE.Mesh(geo, facet(jitterColor(rng, rng.pick(tones), 0.005, 0.03, 0.05)))
		)
		slab.scale.y = lh / R
		slab.position.set(rng.jitter(0, R * 0.12), y + lh * 0.5, rng.jitter(0, R * 0.12))
		slab.rotation.y = rng.range(0, Math.PI * 2)
		g.add(slab)
		y += lh * 0.85
		R *= rng.range(0.78, 0.92)
	}
	if (rng.chance(0.45)) {
		const moss = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(R * 0.9, 1), rng, R * 0.25),
				facet(jitterColor(rng, '#5da24f', 0.01, 0.06, 0.05))
			)
		)
		moss.scale.y = 0.3
		moss.position.y = y + R * 0.12
		g.add(moss)
	}
	return g
}

/** Scattered faceted stone pile. */
export function stonePile(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(4, 7)
	for (let i = 0; i < n; i++) {
		const r = rng.range(0.07, 0.16)
		const s = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(r, 0), rng, r * 0.3),
				facet(jitterColor(rng, rng.pick(['#6b7565', '#78826f', '#8a937f']), 0.005, 0.03, 0.06))
			)
		)
		const a = rng.range(0, Math.PI * 2)
		const d = rng.range(0, 0.3)
		s.position.set(Math.cos(a) * d, r * 0.6, Math.sin(a) * d)
		s.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3)
		g.add(s)
	}
	return g
}

/** Chunky paddle-blade grass cluster — bright, faceted. */
export function grassBlades(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(4, 6)
	for (let i = 0; i < n; i++) {
		const bh = rng.range(0.25, 0.5)
		const blade = shadow(
			new THREE.Mesh(
				new THREE.ConeGeometry(0.045, bh, 4),
				facet(jitterColor(rng, rng.chance(0.5) ? '#5fae3f' : '#7cc94e', 0.015, 0.08, 0.05))
			)
		)
		blade.scale.z = 0.45
		const a = rng.range(0, Math.PI * 2)
		const d = rng.range(0, 0.16)
		blade.position.set(Math.cos(a) * d, bh * 0.45, Math.sin(a) * d)
		blade.rotation.y = rng.range(0, Math.PI * 2)
		blade.rotation.z = rng.jitter(0, 0.28)
		g.add(blade)
	}
	return g
}

/** Birch — pale slender trunk, stacked light-green canopy lobes. */
export function birchTree(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const h = rng.range(1.7, 2.3)
	const trunk = shadow(
		new THREE.Mesh(
			new THREE.CylinderGeometry(0.035, 0.055, h * 0.85, 6),
			facet(jitterColor(rng, '#e3dbc9', 0.004, 0.02, 0.04))
		)
	)
	trunk.position.y = h * 0.42
	g.add(trunk)
	const lobes = rng.int(2, 3)
	for (let i = 0; i < lobes; i++) {
		const r = (0.34 - i * 0.07) * rng.range(0.85, 1.15)
		const lobe = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.3),
				facet(jitterColor(rng, rng.chance(0.5) ? '#8cc763' : '#a5d67a', 0.012, 0.06, 0.04))
			)
		)
		lobe.position.set(rng.jitter(0, 0.08), h * 0.62 + i * r * 1.2, rng.jitter(0, 0.08))
		lobe.scale.y = 0.85
		g.add(lobe)
	}
	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.85, 1.15))
	return g
}

/** Broadleaf — thick trunk, wide clustered dark canopy. */
export function broadleafTree(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const h = rng.range(1.3, 1.8)
	const trunk = shadow(
		new THREE.Mesh(
			new THREE.CylinderGeometry(0.07, 0.12, h * 0.6, 6),
			facet(jitterColor(rng, '#8a5f3c', 0.008, 0.05, 0.05))
		)
	)
	trunk.position.y = h * 0.3
	g.add(trunk)
	const lumps = rng.int(3, 4)
	for (let i = 0; i < lumps; i++) {
		const r = rng.range(0.28, 0.42)
		const lump = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.32),
				facet(jitterColor(rng, rng.chance(0.5) ? '#3f8a45' : '#57a24f', 0.01, 0.05, 0.04))
			)
		)
		const a = (i / lumps) * Math.PI * 2 + rng.jitter(0, 0.5)
		lump.position.set(Math.cos(a) * 0.2, h * 0.68 + rng.jitter(0, 0.1), Math.sin(a) * 0.2)
		lump.scale.y = 0.8
		g.add(lump)
	}
	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.85, 1.2))
	return g
}

/** Fern — arched dark blades fanning from the forest floor. */
export function fern(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(4, 6)
	for (let i = 0; i < n; i++) {
		const bh = rng.range(0.3, 0.5)
		const blade = shadow(
			new THREE.Mesh(
				new THREE.ConeGeometry(0.05, bh, 4),
				facet(jitterColor(rng, '#3f7a3a', 0.012, 0.06, 0.04))
			)
		)
		blade.scale.z = 0.35
		const a = (i / n) * Math.PI * 2 + rng.jitter(0, 0.3)
		blade.position.set(Math.cos(a) * 0.08, bh * 0.38, Math.sin(a) * 0.08)
		blade.rotation.y = -a
		blade.rotation.z = rng.range(0.5, 0.85) * (Math.cos(a) >= 0 ? 1 : -1)
		blade.rotation.x = rng.jitter(0, 0.2)
		g.add(blade)
	}
	return g
}

/** Mushroom cluster — red or brown caps on cream stems. */
export function mushrooms(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(2, 4)
	const capColor = rng.chance(0.55) ? '#c4452f' : '#a5713f'
	for (let i = 0; i < n; i++) {
		const sh = rng.range(0.06, 0.13)
		const stem = shadow(
			new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, sh, 5), facet('#ede3cf'))
		)
		const px = rng.jitter(0, 0.1)
		const pz = rng.jitter(0, 0.1)
		stem.position.set(px, sh / 2, pz)
		g.add(stem)
		const cap = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.ConeGeometry(rng.range(0.05, 0.09), 0.07, 6), rng, 0.012),
				facet(jitterColor(rng, capColor, 0.008, 0.05, 0.04))
			)
		)
		cap.position.set(px, sh + 0.025, pz)
		g.add(cap)
	}
	return g
}

/** Fallen twigs — thin sticks scattered on the ground. */
export function twigSticks(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const n = rng.int(2, 4)
	for (let i = 0; i < n; i++) {
		const len = rng.range(0.3, 0.6)
		const twig = shadow(
			new THREE.Mesh(
				new THREE.CylinderGeometry(0.012, 0.018, len, 4),
				facet(jitterColor(rng, '#9a6d45', 0.008, 0.04, 0.05))
			)
		)
		twig.rotation.z = Math.PI / 2 + rng.jitter(0, 0.15)
		twig.rotation.y = rng.range(0, Math.PI * 2)
		twig.position.set(rng.jitter(0, 0.2), 0.02, rng.jitter(0, 0.2))
		g.add(twig)
	}
	return g
}

/**
 * MOUNTAIN v3 — four formation families with big variety in height and
 * steepness, per the low-poly references:
 *   RIDGE  — 1-3 great asymmetric peaks (elongated, leaning), green ledge
 *            shelves on the flanks, snow above the treeline
 *   MESA   — stratified stacked terraces in warm cliff beige
 *   SPIRES — a cluster of tall narrow rock needles
 *   FIELD  — chunky boulder scatter
 */
export function mountainPeaks(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const beige = rng.chance(0.4)
	const tones = beige ? ['#cfc4b0', '#c0b29c', '#b3a48d'] : ['#8a93a1', '#7e8894', '#99a2ae']
	const kindRoll = rng.next()

	const greenLedge = (x: number, y: number, z: number, r: number): void => {
		const ledge = shadow(
			new THREE.Mesh(
				displaceGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.3),
				facet(jitterColor(rng, '#6cae53', 0.012, 0.06, 0.04))
			)
		)
		ledge.scale.y = 0.22
		ledge.position.set(x, y, z)
		ledge.rotation.y = rng.range(0, Math.PI * 2)
		g.add(ledge)
	}

	if (kindRoll < 0.45) {
		// RIDGE — the skyline formation
		const peaks = rng.int(1, 3)
		for (let i = 0; i < peaks; i++) {
			const R = rng.range(0.7, 1.9) * (i === 0 ? 1 : rng.range(0.5, 0.75))
			const H = rng.range(2.2, 6.2) * (i === 0 ? 1 : rng.range(0.5, 0.8))
			const geo = displaceGeo(new THREE.ConeGeometry(R, H, rng.int(5, 7)), rng, R * 0.3)
			const peakMesh = shadow(
				new THREE.Mesh(geo, facet(jitterColor(rng, rng.pick(tones), 0.004, 0.02, 0.045)))
			)
			const a = rng.range(0, Math.PI * 2)
			const d = i === 0 ? 0 : rng.range(0.7, 1.3)
			peakMesh.position.set(Math.cos(a) * d, H * 0.38, Math.sin(a) * d)
			peakMesh.scale.set(1, 1, rng.range(0.6, 1)) // ridge elongation
			peakMesh.rotation.y = rng.range(0, Math.PI * 2)
			peakMesh.rotation.z = rng.jitter(0, 0.05) // subtle lean
			g.add(peakMesh)

			// green shelves clinging to the flanks
			if (rng.chance(0.65)) {
				const shelves = rng.int(1, 3)
				for (let s = 0; s < shelves; s++) {
					const sa = rng.range(0, Math.PI * 2)
					const sh = H * rng.range(0.18, 0.5)
					const sr = R * (1 - sh / H) * 1.05
					greenLedge(
						peakMesh.position.x + Math.cos(sa) * sr,
						sh,
						peakMesh.position.z + Math.sin(sa) * sr,
						R * rng.range(0.25, 0.45)
					)
				}
			}
			// snow above the treeline
			if (H > 3.6 && rng.chance(0.85)) {
				const cap = shadow(
					new THREE.Mesh(
						displaceGeo(new THREE.ConeGeometry(R * 0.4, H * 0.28, 6), rng, R * 0.09),
						facet(jitterColor(rng, '#f2f3ee', 0.002, 0.01, 0.02))
					)
				)
				cap.position.set(peakMesh.position.x, H * 0.73, peakMesh.position.z)
				cap.scale.copy(peakMesh.scale)
				cap.rotation.y = peakMesh.rotation.y
				g.add(cap)
			}
		}
	} else if (kindRoll < 0.7) {
		// MESA — stratified terraces (always warm cliff beige)
		const mesaTones = ['#cfc4b0', '#c0b29c', '#b3a48d']
		const tiers = rng.int(3, 5)
		let y = 0
		let R = rng.range(1.1, 1.9)
		for (let i = 0; i < tiers; i++) {
			const th = rng.range(0.45, 0.75)
			const geo = displaceGeo(
				new THREE.CylinderGeometry(R * 0.88, R, th, rng.int(6, 8)),
				rng,
				R * 0.16
			)
			const tier = shadow(
				new THREE.Mesh(geo, facet(jitterColor(rng, mesaTones[i % 3], 0.004, 0.02, 0.04)))
			)
			tier.position.set(rng.jitter(0, R * 0.08), y + th * 0.5, rng.jitter(0, R * 0.08))
			tier.rotation.y = rng.range(0, Math.PI * 2)
			g.add(tier)
			y += th * 0.92
			R *= rng.range(0.72, 0.85)
		}
		if (rng.chance(0.6)) greenLedge(rng.jitter(0, 0.3), y + 0.06, rng.jitter(0, 0.3), R * 1.1)
	} else if (kindRoll < 0.85) {
		// SPIRES — narrow rock needles
		const spires = rng.int(3, 5)
		for (let i = 0; i < spires; i++) {
			const R = rng.range(0.16, 0.36)
			const H = rng.range(1.2, 3.4)
			const geo = displaceGeo(new THREE.ConeGeometry(R, H, 5), rng, R * 0.35)
			const spire = shadow(
				new THREE.Mesh(geo, facet(jitterColor(rng, rng.pick(tones), 0.004, 0.02, 0.05)))
			)
			const a = rng.range(0, Math.PI * 2)
			const d = rng.range(0.15, 1.0)
			spire.position.set(Math.cos(a) * d, H * 0.4, Math.sin(a) * d)
			spire.rotation.z = rng.jitter(0, 0.07)
			spire.rotation.y = rng.range(0, Math.PI * 2)
			g.add(spire)
		}
	} else {
		// FIELD — chunky boulders
		const n = rng.int(3, 5)
		for (let i = 0; i < n; i++) {
			const r = rng.range(0.4, 0.95)
			const b = shadow(
				new THREE.Mesh(
					displaceGeo(new THREE.IcosahedronGeometry(r, 1), rng, r * 0.34),
					facet(jitterColor(rng, rng.pick(tones), 0.004, 0.02, 0.05))
				)
			)
			const a = rng.range(0, Math.PI * 2)
			const d = rng.range(0, 1.1)
			b.position.set(Math.cos(a) * d, r * 0.55, Math.sin(a) * d)
			b.scale.y = rng.range(0.6, 0.85)
			b.rotation.set(rng.jitter(0, 0.4), rng.range(0, Math.PI * 2), rng.jitter(0, 0.4))
			g.add(b)
		}
	}
	return g
}

/** Terracotta mud mound — CLAYPIT signature. */
export function mudMound(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const mound = shadow(
		new THREE.Mesh(
			new THREE.SphereGeometry(rng.range(0.12, 0.2), 9, 6),
			clay(jitterColor(rng, '#c08258', 0.008, 0.04, 0.05))
		)
	)
	mound.scale.y = rng.range(0.35, 0.5)
	mound.position.y = 0.04
	g.add(mound)
	if (rng.chance(0.6)) {
		const top = shadow(
			new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 5), clay(jitterColor(rng, '#a9703f')))
		)
		top.scale.y = 0.4
		top.position.y = 0.1
		g.add(top)
	}
	return g
}

/** Cactus — DUNES alternative to puff trees. */
export function cactus(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const green = jitterColor(rng, '#6fae7d')
	const body = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.22, 3, 8), clay(green)))
	body.position.y = 0.18
	g.add(body)
	if (rng.chance(0.6)) {
		const arm = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 3, 8), clay(green)))
		arm.position.set(0.1, 0.2, 0)
		arm.rotation.z = -0.5
		g.add(arm)
	}
	g.rotation.y = rng.range(0, Math.PI * 2)
	g.scale.setScalar(rng.range(0.8, 1.2))
	return g
}

/* --- buildings ------------------------------------------------------------
 * Player-placed structures, and the upgrade path a hex walks:
 *   LV.1 tent  ->  LV.2 glass dome  ->  LV.3 stone-founded dome
 * Unlike the natural pieces above these are built at world scale (roughly a
 * third of a hex across) and placed at the center of a hex, so they never
 * take the global decoration downscale.
 * ------------------------------------------------------------------------ */

const DOME_GLASS = ['#8fd3e8', '#a5dced', '#7cc6de', '#b8e6f2', '#93d8ea']
const TIMBER = '#c08a52'
const TIMBER_DARK = '#a9743f'
const STONE = '#b9b2a4'
const STONE_LIGHT = '#cfc8ba'

/**
 * The geodesic glass shell shared by both dome levels: the upper half of an
 * icosphere where every triangle becomes its own slightly tinted, slightly
 * inset pane, with timber struts left exposed between them. Panes merge into
 * one transparent mesh so a whole dome stays at a handful of draw calls.
 */
function geodesicShell(
	R: number,
	detail: number,
	opts: { panes?: string[]; strut?: string; opacity?: number } = {}
): THREE.Group {
	const PANES = opts.panes ?? DOME_GLASS
	const STRUT = opts.strut ?? TIMBER
	const g = new THREE.Group()
	const shell = new THREE.IcosahedronGeometry(R, detail).toNonIndexed()
	const pos = shell.getAttribute('position')
	const paneGeos: THREE.BufferGeometry[] = []
	const strutGeos: THREE.BufferGeometry[] = []
	const a = new THREE.Vector3()
	const b = new THREE.Vector3()
	const c = new THREE.Vector3()
	const mid = new THREE.Vector3()
	const tint = new THREE.Color()

	for (let t = 0; t < pos.count; t += 3) {
		a.fromBufferAttribute(pos, t)
		b.fromBufferAttribute(pos, t + 1)
		c.fromBufferAttribute(pos, t + 2)
		mid
			.copy(a)
			.add(b)
			.add(c)
			.multiplyScalar(1 / 3)
		if (mid.y < -0.02) continue // keep the upper hemisphere

		const pane = new THREE.BufferGeometry()
		const verts: number[] = []
		for (const v of [a, b, c]) {
			const p = v.clone().lerp(mid, 0.07).multiplyScalar(0.99)
			verts.push(p.x, p.y, p.z)
		}
		pane.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
		tint.set(PANES[paneGeos.length % PANES.length])
		const col = new Float32Array(9)
		for (let v = 0; v < 3; v++) {
			col[v * 3] = tint.r
			col[v * 3 + 1] = tint.g
			col[v * 3 + 2] = tint.b
		}
		pane.setAttribute('color', new THREE.BufferAttribute(col, 3))
		pane.computeVertexNormals()
		paneGeos.push(pane)

		for (const [p, q] of [
			[a, b],
			[b, c],
			[c, a]
		] as const) {
			const strut = new THREE.BoxGeometry(0.036 * R, 0.036 * R, p.distanceTo(q))
			const m = new THREE.Object3D()
			m.position.copy(p).add(q).multiplyScalar(0.5)
			m.lookAt(q)
			m.updateMatrix()
			strut.applyMatrix4(m.matrix)
			strutGeos.push(strut)
		}
	}
	shell.dispose()

	const panes = mergeGeometries(paneGeos, false)
	if (panes) {
		g.add(
			new THREE.Mesh(
				panes,
				new THREE.MeshStandardMaterial({
					vertexColors: true,
					roughness: 0.22,
					metalness: 0.05,
					flatShading: true,
					transparent: true,
					opacity: opts.opacity ?? 0.66,
					side: THREE.DoubleSide
				})
			)
		)
	}
	for (const p of paneGeos) p.dispose()

	const struts = mergeGeometries(strutGeos, false)
	if (struts) g.add(new THREE.Mesh(struts, facet(STRUT)))
	for (const st of strutGeos) st.dispose()

	// timber ring closing the shell at its foot
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(R * 0.995, 0.05 * R, 4, 9),
		facet(opts.strut ? STRUT : TIMBER_DARK)
	)
	ring.rotation.x = Math.PI / 2
	g.add(ring)
	return g
}

/** Pointed timber lantern that crowns the upgraded dome. */
function lantern(R: number): THREE.Group {
	const g = new THREE.Group()
	const drum = new THREE.Mesh(new THREE.CylinderGeometry(R, R, R * 1.1, 6), facet(TIMBER))
	drum.position.y = R * 0.55
	g.add(drum)
	const roof = new THREE.Mesh(new THREE.ConeGeometry(R * 1.5, R * 1.3, 6), facet(TIMBER_DARK))
	roof.position.y = R * 1.75
	g.add(roof)
	const finial = new THREE.Mesh(new THREE.SphereGeometry(R * 0.22, 6, 5), facet(TIMBER_DARK))
	finial.position.y = R * 2.5
	g.add(finial)
	return g
}

/** A ring of timber posts and rails — the balcony fence on LV.3. */
function railing(radius: number, height: number, posts: number): THREE.Group {
	const g = new THREE.Group()
	const geos: THREE.BufferGeometry[] = []
	for (let i = 0; i < posts; i++) {
		const ang = (Math.PI * 2 * i) / posts
		const post = new THREE.BoxGeometry(0.05, height, 0.05).toNonIndexed()
		post.translate(Math.cos(ang) * radius, height / 2, Math.sin(ang) * radius)
		geos.push(post)
	}
	for (const h of [height * 0.55, height]) {
		const rail = new THREE.TorusGeometry(radius, 0.028, 4, posts)
		rail.rotateX(Math.PI / 2)
		rail.translate(0, h, 0)
		geos.push(rail.toNonIndexed())
	}
	const merged = mergeGeometries(geos, false)
	for (const geo of geos) geo.dispose()
	if (merged) g.add(new THREE.Mesh(merged, facet(TIMBER)))
	return g
}

/**
 * A campfire: a stone ring, logs stacked into a teepee over a couple lying
 * flat, and a faceted flame. The flame is emissive rather than lit by a real
 * light — it has to glow at night, and a point light per campfire would cost
 * a shadow-casting light for every tent on the island.
 */
function campfire(rng: Rng): THREE.Group {
	const g = new THREE.Group()

	// stone ring
	const stoneGeos: THREE.BufferGeometry[] = []
	const stones = rng.int(7, 9)
	for (let i = 0; i < stones; i++) {
		const ang = (Math.PI * 2 * i) / stones + rng.jitter(0, 0.15)
		const stone = new THREE.DodecahedronGeometry(rng.range(0.07, 0.11), 0).toNonIndexed()
		stone.scale(1, 0.7, 1)
		stone.rotateY(rng.range(0, Math.PI))
		stone.translate(Math.cos(ang) * 0.34, 0.04, Math.sin(ang) * 0.34)
		stoneGeos.push(stone)
	}
	const ring = mergeGeometries(stoneGeos, false)
	if (ring) g.add(new THREE.Mesh(displaceGeo(ring, rng, 0.012), facet('#9c968a')))
	for (const sg of stoneGeos) sg.dispose()

	// logs: two lying flat, three leaning into a teepee
	const logGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < 2; i++) {
		const log = new THREE.CylinderGeometry(0.05, 0.055, 0.46, 6).toNonIndexed()
		log.rotateZ(Math.PI / 2)
		log.rotateY(rng.range(0, Math.PI))
		log.translate(rng.jitter(0, 0.05), 0.055, rng.jitter(0, 0.05))
		logGeos.push(log)
	}
	for (let i = 0; i < 3; i++) {
		const ang = (Math.PI * 2 * i) / 3 + rng.jitter(0, 0.2)
		const log = new THREE.CylinderGeometry(0.035, 0.045, 0.42, 6).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * 0.11, 0.19, Math.sin(ang) * 0.11)
		m.rotation.set(Math.cos(ang) * 0.55, -ang, Math.sin(ang) * -0.55, 'YXZ')
		m.updateMatrix()
		log.applyMatrix4(m.matrix)
		logGeos.push(log)
	}
	const logs = mergeGeometries(logGeos, false)
	if (logs) g.add(new THREE.Mesh(logs, facet('#9a6b40')))
	for (const lg of logGeos) lg.dispose()

	// the flame: stacked faceted shards, hotter and paler toward the tip
	const FLAME = [
		{ r: 0.13, h: 0.24, y: 0.16, color: '#e86a2a', emissive: '#c9451a' },
		{ r: 0.1, h: 0.2, y: 0.28, color: '#f7a52c', emissive: '#e07b12' },
		{ r: 0.06, h: 0.14, y: 0.4, color: '#ffd76b', emissive: '#ffb020' }
	]
	for (const layer of FLAME) {
		const shard = new THREE.Mesh(
			displaceGeo(new THREE.ConeGeometry(layer.r, layer.h, 5), rng, 0.02),
			new THREE.MeshStandardMaterial({
				color: layer.color,
				emissive: layer.emissive,
				emissiveIntensity: 1.15,
				roughness: 0.6,
				metalness: 0,
				flatShading: true
			})
		)
		shard.position.y = layer.y
		shard.rotation.y = rng.range(0, Math.PI)
		g.add(shard)
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/**
 * LV.1 — the tent: where a founder starts. A six-panel dome tent, green
 * canopy over a pale skirt wall, with bent poles running over the seams and
 * a dark doorway, straight off the camping-tent reference.
 */
export function tent1(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1
	const SIDES = 6

	// pale lower skirt
	const skirt = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 0.98, R, 0.34, SIDES, 1),
		facet('#ddd6c4')
	)
	skirt.position.y = 0.17
	g.add(skirt)

	// green canopy: a flattened hemisphere sitting on the skirt
	const canopy = new THREE.Mesh(
		new THREE.SphereGeometry(R * 0.99, SIDES * 2, 4, 0, Math.PI * 2, 0, Math.PI / 2),
		facet('#6d8c5a')
	)
	canopy.scale.y = 0.72
	canopy.position.y = 0.34
	g.add(canopy)

	// poles arching over the seams
	const poleGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < SIDES / 2; i++) {
		const ang = (Math.PI * i) / (SIDES / 2)
		const curve = new THREE.EllipseCurve(0, 0, R * 0.99, R * 0.72, 0, Math.PI, false, 0)
		const pts = curve.getPoints(24).map((p) => new THREE.Vector3(p.x, p.y, 0))
		const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.022, 4, false)
		tube.rotateY(ang)
		tube.translate(0, 0.34, 0)
		poleGeos.push(tube.toNonIndexed())
	}
	const poles = mergeGeometries(poleGeos, false)
	if (poles) g.add(new THREE.Mesh(poles, facet('#3f4a44')))
	for (const pg of poleGeos) pg.dispose()

	// doorway + a small window on the far side
	const door = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.06), facet('#3a3833'))
	door.position.set(0, 0.2, R * 0.85)
	g.add(door)
	const arch = new THREE.Mesh(
		new THREE.CylinderGeometry(0.21, 0.21, 0.06, 8, 1, false, 0, Math.PI),
		facet('#3a3833')
	)
	arch.rotation.set(Math.PI / 2, 0, 0)
	arch.position.set(0, 0.4, R * 0.85)
	g.add(arch)
	const window = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), facet('#4a544d'))
	window.position.set(0, 0.42, -R * 0.86)
	g.add(window)

	// the campfire, set off the tent door with room to sit around it
	const fire = campfire(rng)
	fire.position.set(rng.range(-0.35, 0.35), 0, R * 1.75)
	fire.scale.setScalar(1.15)
	g.add(fire)

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

const CANVAS_WHITE = ['#f4f1e8', '#eae6da', '#fbf9f2', '#e4dfd2', '#f0ece1']

/**
 * LV.2 — the glamping dome: a pale canvas shell on a timber deck. Same
 * geodesic frame as its bigger siblings, but the panels are stretched fabric
 * rather than glass — near-opaque, warm white, lit rather than transparent —
 * and it stands on boards instead of stone.
 */
export function dome1(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1

	// timber deck, a plank ring under the shell
	const deckPlate = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 1.24, R * 1.2, 0.1, 10, 1),
		facet(TIMBER)
	)
	deckPlate.position.y = 0.05
	g.add(deckPlate)

	const skirt = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 1.26, R * 1.3, 0.06, 10, 1),
		facet(TIMBER_DARK)
	)
	skirt.position.y = 0.03
	g.add(skirt)

	const shell = geodesicShell(R, 1, {
		panes: CANVAS_WHITE,
		strut: '#d8cdb8',
		opacity: 0.97
	})
	shell.position.y = 0.1
	g.add(shell)

	// a round window and a canvas door flap
	const window = new THREE.Mesh(new THREE.CircleGeometry(0.22, 10), facet('#9fd0dd'))
	window.position.set(-R * 0.42, 0.55, R * 0.78)
	window.lookAt(-R * 1.2, 0.55, R * 2.2)
	g.add(window)

	const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.05), facet('#c7bda6'))
	door.position.set(0, 0.35, R * 0.9)
	g.add(door)

	// a small porch step and two chairs by the deck edge
	const step = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.26), facet(TIMBER_DARK))
	step.position.set(0, 0.1, R * 1.3)
	g.add(step)
	for (const side of [-1, 1]) {
		const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), facet(TIMBER_DARK))
		seat.position.set(side * 0.55, 0.16, R * 1.02)
		g.add(seat)
		const back = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.04), facet(TIMBER_DARK))
		back.position.set(side * 0.55, 0.24, R * 0.94)
		g.add(back)
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/**
 * A wall panel with a round-arched opening cut out of it — the piece the
 * whole arcade is built from. Ten of these, set as the faces of a decagon,
 * give real arches from every angle instead of square holes with blocks
 * stuck on top.
 */
function archPanel(
	width: number,
	height: number,
	openWidth: number,
	depth: number
): THREE.BufferGeometry {
	const shape = new THREE.Shape()
	shape.moveTo(-width / 2, 0)
	shape.lineTo(width / 2, 0)
	shape.lineTo(width / 2, height)
	shape.lineTo(-width / 2, height)
	shape.closePath()

	const r = openWidth / 2
	const springLine = height - r - 0.02
	const hole = new THREE.Path()
	hole.moveTo(-r, 0)
	hole.lineTo(-r, springLine)
	hole.absarc(0, springLine, r, Math.PI, 0, true)
	hole.lineTo(r, 0)
	hole.closePath()
	shape.holes.push(hole)

	return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).toNonIndexed()
}

/** A spiky low-poly plant — the agave-ish greenery banked around the stone. */
function leafPlant(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const blades = rng.int(5, 8)
	const green = rng.chance(0.5) ? '#5f9c46' : '#74b054'
	for (let i = 0; i < blades; i++) {
		const ang = (Math.PI * 2 * i) / blades + rng.jitter(0, 0.3)
		const h = rng.range(0.16, 0.3)
		const blade = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 3), facet(green))
		blade.position.set(Math.cos(ang) * 0.05, h / 2, Math.sin(ang) * 0.05)
		blade.rotation.set(Math.cos(ang) * 0.5, -ang, Math.sin(ang) * -0.5)
		g.add(blade)
	}
	return g
}

/** A timber deck with a railing along its outer edge. */
function deck(width: number, depth: number): THREE.Group {
	const g = new THREE.Group()
	const floor = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), facet(TIMBER))
	g.add(floor)
	const postGeos: THREE.BufferGeometry[] = []
	for (const side of [-1, 1]) {
		for (let i = 0; i <= 3; i++) {
			const post = new THREE.BoxGeometry(0.045, 0.22, 0.045).toNonIndexed()
			post.translate(side * (width / 2 - 0.03), 0.11, -depth / 2 + (depth / 3) * i)
			postGeos.push(post)
		}
		const rail = new THREE.BoxGeometry(0.04, 0.04, depth).toNonIndexed()
		rail.translate(side * (width / 2 - 0.03), 0.21, 0)
		postGeos.push(rail)
	}
	const merged = mergeGeometries(postGeos, false)
	for (const pg of postGeos) pg.dispose()
	if (merged) g.add(new THREE.Mesh(merged, facet(TIMBER_DARK)))
	return g
}

/**
 * LV.3 — the founded dome: the glass shell raised onto a stone ground floor
 * of round-arched bays, ringed by a timber balcony, with a dormer set into
 * the dome, a turret standing on the deck, a landing bridge at the front and
 * planting banked against the stonework.
 */
export function dome2(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1
	const BASE_R = R * 1.16
	const BASE_H = 0.66
	const BAYS = 10
	const PLINTH_H = 0.1
	const WALL_H = BASE_H - PLINTH_H

	// plinth the whole thing stands on
	const plinth = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.04, BASE_R * 1.1, PLINTH_H, BAYS * 2),
		facet(STONE)
	)
	plinth.position.y = PLINTH_H / 2
	g.add(plinth)

	// the shadowed interior seen through the arches
	const inner = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 0.92, BASE_R * 0.92, WALL_H, BAYS * 2),
		facet('#4a453d')
	)
	inner.position.y = PLINTH_H + WALL_H / 2
	g.add(inner)

	// the arcade: ten arched bays forming the faces of a decagon
	const bayWidth = 2 * BASE_R * Math.tan(Math.PI / BAYS) + 0.01
	// alternating stone tones so the wall reads as courses of cut blocks
	// rather than one poured grey cylinder
	const bayGeos: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []]
	for (let i = 0; i < BAYS; i++) {
		const ang = (Math.PI * 2 * i) / BAYS
		const panel = archPanel(bayWidth, WALL_H, bayWidth * 0.62, 0.1)
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * BASE_R, PLINTH_H, Math.sin(ang) * BASE_R)
		m.rotation.y = -ang + Math.PI / 2
		m.updateMatrix()
		panel.applyMatrix4(m.matrix)
		bayGeos[i % 2].push(panel)
	}
	for (const [i, group] of bayGeos.entries()) {
		const arcade = mergeGeometries(group, false)
		if (arcade)
			g.add(new THREE.Mesh(displaceGeo(arcade, rng, 0.005), facet(i === 0 ? STONE : STONE_LIGHT)))
		for (const bg of group) bg.dispose()
	}

	// lintel course, balcony floor and its fence
	const lintel = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.02, BASE_R * 1.02, 0.08, BAYS * 2),
		facet(STONE)
	)
	lintel.position.y = BASE_H + 0.04
	g.add(lintel)

	const cap = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.08, BASE_R * 1.08, 0.06, BAYS * 2),
		facet(STONE_LIGHT)
	)
	cap.position.y = BASE_H + 0.11
	g.add(cap)

	const DECK_Y = BASE_H + 0.14
	const fence = railing(BASE_R * 1.02, 0.26, BAYS * 3)
	fence.position.y = DECK_Y
	g.add(fence)

	// the glass shell — wider and finer-faceted than LV.2, and stretched a
	// little so it rises like a real dome instead of sitting like a bowl
	const SHELL_R = R * 1.02
	const RISE = 1.12
	const shell = geodesicShell(SHELL_R, 2)
	shell.scale.y = RISE
	shell.position.y = DECK_Y
	g.add(shell)

	const crown = lantern(0.16)
	crown.position.y = DECK_Y + SHELL_R * RISE - 0.04
	g.add(crown)

	// dormer set INTO the dome face, not hung off it
	const dormer = new THREE.Group()
	const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3), facet(TIMBER))
	dBody.position.y = 0.15
	dormer.add(dBody)
	const dRoof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 4), facet(TIMBER_DARK))
	dRoof.rotation.y = Math.PI / 4
	dRoof.position.y = 0.4
	dormer.add(dRoof)
	const dPane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.04), facet('#8fd3e8'))
	dPane.position.set(0, 0.17, 0.15)
	dormer.add(dPane)
	dormer.position.set(0, DECK_Y + 0.06, SHELL_R * 0.66)
	g.add(dormer)

	// turret standing ON the balcony deck
	const turret = new THREE.Group()
	const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.42, 6), facet(TIMBER))
	drum.position.y = 0.21
	turret.add(drum)
	const tWindow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.05), facet('#8fd3e8'))
	tWindow.position.set(0, 0.26, 0.19)
	turret.add(tWindow)
	const tRoof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.26, 6), facet(TIMBER_DARK))
	tRoof.position.y = 0.55
	turret.add(tRoof)
	turret.position.set(BASE_R * 0.78, DECK_Y, BASE_R * 0.54)
	g.add(turret)

	// landing bridge out to the ground
	const bridge = deck(0.62, 0.95)
	bridge.position.set(0, PLINTH_H + 0.02, BASE_R * 1.24)
	g.add(bridge)

	// boulders and planting banked against the stonework
	for (let i = 0; i < 9; i++) {
		const ang = rng.range(0, Math.PI * 2)
		const d = BASE_R * rng.range(1.02, 1.32)
		if (rng.chance(0.55)) {
			const boulder = new THREE.Mesh(
				displaceGeo(new THREE.DodecahedronGeometry(rng.range(0.15, 0.26), 0), rng, 0.05),
				facet(rng.chance(0.5) ? STONE : STONE_LIGHT)
			)
			boulder.position.set(Math.cos(ang) * d, 0.06, Math.sin(ang) * d)
			boulder.rotation.set(rng.next(), rng.next(), rng.next())
			g.add(boulder)
		} else {
			const plant = leafPlant(rng)
			plant.position.set(Math.cos(ang) * d, 0.05, Math.sin(ang) * d)
			plant.scale.setScalar(rng.range(0.8, 1.25))
			g.add(plant)
		}
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** A ring of little gabled units around the dome's foot — the shopfronts and
 * windows that give the grand dome its inhabited look. */
function dormerRing(radius: number, count: number, unit: number): THREE.Group {
	const g = new THREE.Group()
	const wallGeos: THREE.BufferGeometry[] = []
	const roofGeos: THREE.BufferGeometry[] = []
	const paneGeos: THREE.BufferGeometry[] = []

	for (let i = 0; i < count; i++) {
		const ang = (Math.PI * 2 * i) / count
		const place = (geo: THREE.BufferGeometry, y: number, out: number): THREE.BufferGeometry => {
			const m = new THREE.Object3D()
			m.position.set(Math.cos(ang) * (radius + out), y, Math.sin(ang) * (radius + out))
			m.rotation.y = -ang
			m.updateMatrix()
			return geo.applyMatrix4(m.matrix)
		}
		wallGeos.push(
			place(new THREE.BoxGeometry(unit, unit * 0.9, unit * 0.7).toNonIndexed(), unit * 0.45, 0)
		)
		const roof = new THREE.ConeGeometry(unit * 0.82, unit * 0.5, 4).toNonIndexed()
		roof.rotateY(Math.PI / 4)
		roofGeos.push(place(roof, unit * 1.15, 0))
		paneGeos.push(
			place(
				new THREE.BoxGeometry(unit * 0.5, unit * 0.45, 0.04).toNonIndexed(),
				unit * 0.5,
				unit * 0.36
			)
		)
	}

	const walls = mergeGeometries(wallGeos, false)
	if (walls) g.add(new THREE.Mesh(walls, facet('#e6ddc8')))
	const roofs = mergeGeometries(roofGeos, false)
	if (roofs) g.add(new THREE.Mesh(roofs, facet(TIMBER_DARK)))
	const panes = mergeGeometries(paneGeos, false)
	if (panes) g.add(new THREE.Mesh(panes, facet('#8a6238')))
	for (const geo of [...wallGeos, ...roofGeos, ...paneGeos]) geo.dispose()
	return g
}

/** An open timber canopy on posts — the side porches of the grand dome. */
function pergola(width: number, depth: number, height: number): THREE.Group {
	const g = new THREE.Group()
	const geos: THREE.BufferGeometry[] = []
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			const post = new THREE.BoxGeometry(0.06, height, 0.06).toNonIndexed()
			post.translate((sx * (width - 0.1)) / 2, height / 2, (sz * (depth - 0.1)) / 2)
			geos.push(post)
		}
	}
	const merged = mergeGeometries(geos, false)
	for (const geo of geos) geo.dispose()
	if (merged) g.add(new THREE.Mesh(merged, facet(TIMBER)))
	const roof = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, depth), facet(TIMBER_DARK))
	roof.position.y = height
	g.add(roof)
	return g
}

/** A clipped shrub in a timber planter — the potted greenery at the doors. */
function planter(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const box = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.13, 0.17), facet('#a97445'))
	box.position.y = 0.065
	g.add(box)
	const bush = new THREE.Mesh(
		displaceGeo(new THREE.IcosahedronGeometry(0.14, 0), rng, 0.03),
		facet(rng.chance(0.5) ? '#5f9c46' : '#74b054')
	)
	bush.position.y = 0.22
	bush.scale.y = rng.range(1.1, 1.5)
	g.add(bush)
	return g
}

/**
 * LV.4 — the grand dome: the founded dome grown into a full house. A wide
 * stone arcade with tall arches, a balcony ringed by gabled shopfronts under
 * the glass, a broad geodesic roof, a lantern crown, side pergolas, an entry
 * stair and planting all around.
 */
export function dome3(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1
	const BASE_R = R * 1.32
	const BASE_H = 0.72
	const BAYS = 14
	const PLINTH_H = 0.1
	const WALL_H = BASE_H - PLINTH_H

	const plinth = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.04, BASE_R * 1.12, PLINTH_H, BAYS * 2),
		facet(STONE)
	)
	plinth.position.y = PLINTH_H / 2
	g.add(plinth)

	const inner = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 0.93, BASE_R * 0.93, WALL_H, BAYS * 2),
		facet('#453f38')
	)
	inner.position.y = PLINTH_H + WALL_H / 2
	g.add(inner)

	// the arcade — taller arches than LV.3, in alternating stone tones
	const bayWidth = 2 * BASE_R * Math.tan(Math.PI / BAYS) + 0.01
	const bayGeos: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []]
	for (let i = 0; i < BAYS; i++) {
		const ang = (Math.PI * 2 * i) / BAYS
		const panel = archPanel(bayWidth, WALL_H, bayWidth * 0.68, 0.1)
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * BASE_R, PLINTH_H, Math.sin(ang) * BASE_R)
		m.rotation.y = -ang + Math.PI / 2
		m.updateMatrix()
		panel.applyMatrix4(m.matrix)
		bayGeos[i % 2].push(panel)
	}
	for (const [i, group] of bayGeos.entries()) {
		const arcade = mergeGeometries(group, false)
		if (arcade)
			g.add(new THREE.Mesh(displaceGeo(arcade, rng, 0.005), facet(i === 0 ? STONE : STONE_LIGHT)))
		for (const bg of group) bg.dispose()
	}

	const lintel = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.02, BASE_R * 1.02, 0.08, BAYS * 2),
		facet(STONE)
	)
	lintel.position.y = BASE_H + 0.04
	g.add(lintel)

	const cap = new THREE.Mesh(
		new THREE.CylinderGeometry(BASE_R * 1.1, BASE_R * 1.1, 0.06, BAYS * 2),
		facet(STONE_LIGHT)
	)
	cap.position.y = BASE_H + 0.11
	g.add(cap)

	const DECK_Y = BASE_H + 0.14
	const fence = railing(BASE_R * 1.05, 0.24, BAYS * 3)
	fence.position.y = DECK_Y
	g.add(fence)

	// the ring of shopfronts tucked under the glass
	const dormers = dormerRing(BASE_R * 0.86, BAYS, 0.26)
	dormers.position.y = DECK_Y
	g.add(dormers)

	// the broad glass roof, springing from behind the shopfronts
	const SHELL_R = R * 1.16
	const RISE = 1.05
	const shell = geodesicShell(SHELL_R, 2)
	shell.scale.y = RISE
	shell.position.y = DECK_Y + 0.28
	g.add(shell)

	const crown = lantern(0.18)
	crown.position.y = DECK_Y + 0.28 + SHELL_R * RISE - 0.05
	g.add(crown)

	// side pergolas standing on the plinth
	for (const side of [-1, 1]) {
		const porch = pergola(0.5, 0.42, 0.34)
		porch.position.set(side * BASE_R * 0.92, PLINTH_H, BASE_R * 0.72)
		porch.rotation.y = side * -0.5
		g.add(porch)
	}

	// entry stair down from the main arch
	for (let i = 0; i < 3; i++) {
		const tread = new THREE.Mesh(
			new THREE.BoxGeometry(0.44 + i * 0.06, 0.05, 0.12),
			facet(i === 2 ? STONE : STONE_LIGHT)
		)
		tread.position.set(0, PLINTH_H - i * 0.035, BASE_R * 1.06 + i * 0.11)
		g.add(tread)
	}

	// planters at the doors and shrubs banked against the stone
	for (const side of [-1, 1]) {
		const pot = planter(rng)
		pot.position.set(side * 0.34, PLINTH_H, BASE_R * 1.02)
		g.add(pot)
	}
	for (let i = 0; i < 12; i++) {
		const ang = rng.range(0, Math.PI * 2)
		const d = BASE_R * rng.range(1.04, 1.3)
		if (rng.chance(0.45)) {
			const boulder = new THREE.Mesh(
				displaceGeo(new THREE.DodecahedronGeometry(rng.range(0.13, 0.24), 0), rng, 0.05),
				facet(rng.chance(0.5) ? STONE : STONE_LIGHT)
			)
			boulder.position.set(Math.cos(ang) * d, 0.06, Math.sin(ang) * d)
			boulder.rotation.set(rng.next(), rng.next(), rng.next())
			g.add(boulder)
		} else {
			const plant = leafPlant(rng)
			plant.position.set(Math.cos(ang) * d, 0.05, Math.sin(ang) * d)
			plant.scale.setScalar(rng.range(0.85, 1.3))
			g.add(plant)
		}
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** A clipped conical tree — the topiary that lines the dome terraces. */
function topiary(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const h = rng.range(0.22, 0.34)
	const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.07, 5), facet('#8a6238'))
	trunk.position.y = 0.035
	g.add(trunk)
	const crown = new THREE.Mesh(
		displaceGeo(new THREE.ConeGeometry(rng.range(0.08, 0.11), h, 6), rng, 0.012),
		facet(rng.chance(0.5) ? '#6faa55' : '#83bb62')
	)
	crown.position.y = 0.07 + h / 2
	g.add(crown)
	return g
}

/** A ring of slanted timber canopies — the shop awnings of the lower terrace. */
function awningRing(radius: number, count: number, width: number): THREE.Group {
	const g = new THREE.Group()
	const geos: THREE.BufferGeometry[] = []
	for (let i = 0; i < count; i++) {
		const ang = (Math.PI * 2 * i) / count
		const awning = new THREE.BoxGeometry(width, 0.03, 0.26).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * radius, 0, Math.sin(ang) * radius)
		m.rotation.set(0.42, -ang, 0)
		m.updateMatrix()
		awning.applyMatrix4(m.matrix)
		geos.push(awning)
	}
	const merged = mergeGeometries(geos, false)
	for (const geo of geos) geo.dispose()
	if (merged) g.add(new THREE.Mesh(merged, facet(TIMBER)))
	return g
}

/** A ring of shopfront walls with doors — the inhabited band of a terrace. */
function shopRing(radius: number, count: number, height: number, unit: number): THREE.Group {
	const g = new THREE.Group()
	const wallGeos: THREE.BufferGeometry[] = []
	const doorGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < count; i++) {
		const ang = (Math.PI * 2 * i) / count
		const place = (geo: THREE.BufferGeometry, y: number, out: number): THREE.BufferGeometry => {
			const m = new THREE.Object3D()
			m.position.set(Math.cos(ang) * (radius + out), y, Math.sin(ang) * (radius + out))
			m.rotation.y = -ang
			m.updateMatrix()
			return geo.applyMatrix4(m.matrix)
		}
		wallGeos.push(
			place(new THREE.BoxGeometry(unit, height, unit * 0.5).toNonIndexed(), height / 2, 0)
		)
		doorGeos.push(
			place(
				new THREE.BoxGeometry(unit * 0.4, height * 0.66, 0.04).toNonIndexed(),
				height * 0.33,
				unit * 0.26
			)
		)
	}
	const walls = mergeGeometries(wallGeos, false)
	if (walls) g.add(new THREE.Mesh(walls, facet('#e6ddc8')))
	const doors = mergeGeometries(doorGeos, false)
	if (doors) g.add(new THREE.Mesh(doors, facet('#8a6238')))
	for (const geo of [...wallGeos, ...doorGeos]) geo.dispose()
	return g
}

/** Builds a stone arcade drum: plinth, dark interior, arched bays, lintel. */
function arcadeDrum(
	rng: Rng,
	radius: number,
	height: number,
	bays: number,
	plinthHeight: number
): THREE.Group {
	const g = new THREE.Group()
	const wallH = height - plinthHeight

	const plinth = new THREE.Mesh(
		new THREE.CylinderGeometry(radius * 1.04, radius * 1.1, plinthHeight, bays * 2),
		facet(STONE)
	)
	plinth.position.y = plinthHeight / 2
	g.add(plinth)

	const inner = new THREE.Mesh(
		new THREE.CylinderGeometry(radius * 0.94, radius * 0.94, wallH, bays * 2),
		facet('#453f38')
	)
	inner.position.y = plinthHeight + wallH / 2
	g.add(inner)

	const bayWidth = 2 * radius * Math.tan(Math.PI / bays) + 0.01
	const bayGeos: [THREE.BufferGeometry[], THREE.BufferGeometry[]] = [[], []]
	for (let i = 0; i < bays; i++) {
		const ang = (Math.PI * 2 * i) / bays
		const panel = archPanel(bayWidth, wallH, bayWidth * 0.68, 0.1)
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * radius, plinthHeight, Math.sin(ang) * radius)
		m.rotation.y = -ang + Math.PI / 2
		m.updateMatrix()
		panel.applyMatrix4(m.matrix)
		bayGeos[i % 2].push(panel)
	}
	for (const [i, group] of bayGeos.entries()) {
		const arcade = mergeGeometries(group, false)
		if (arcade)
			g.add(new THREE.Mesh(displaceGeo(arcade, rng, 0.005), facet(i === 0 ? STONE : STONE_LIGHT)))
		for (const bg of group) bg.dispose()
	}

	const lintel = new THREE.Mesh(
		new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, 0.08, bays * 2),
		facet(STONE)
	)
	lintel.position.y = height + 0.04
	g.add(lintel)

	const cap = new THREE.Mesh(
		new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, 0.06, bays * 2),
		facet(STONE_LIGHT)
	)
	cap.position.y = height + 0.11
	g.add(cap)

	return g
}

/**
 * LV.5 — the terraced dome: the grand dome grown a storey. Two full ring
 * terraces stack under the glass — a lower one of awninged shopfronts and a
 * higher one of gabled houses, each with its own timber balustrade and rows
 * of topiary — over a wide stone arcade at ground level.
 */
export function dome4(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	// WIDE, not tall: the reference is roughly twice as broad as it is high,
	// so the storeys stay low and the glass roof spans nearly the full base
	const R = 1
	const BASE_R = R * 2.05
	const BASE_H = 0.6
	const BAYS = 20

	/** Rings a terrace deck with topiary, and drops a few benches in. */
	const dressTerrace = (radius: number, y: number, count: number): void => {
		for (let i = 0; i < count; i++) {
			const ang = (Math.PI * 2 * i) / count + rng.jitter(0, 0.08)
			const tree = topiary(rng)
			tree.position.set(Math.cos(ang) * radius, y, Math.sin(ang) * radius)
			tree.scale.setScalar(rng.range(0.85, 1.15))
			g.add(tree)
		}
	}

	// --- ground floor: the wide stone arcade -----------------------------
	g.add(arcadeDrum(rng, BASE_R, BASE_H, BAYS, 0.1))

	const T1_Y = BASE_H + 0.14
	const fence1 = railing(BASE_R * 1.06, 0.24, BAYS * 3)
	fence1.position.y = T1_Y
	g.add(fence1)

	// --- first terrace: awninged shopfronts ------------------------------
	const SHOP_H = 0.4
	const shops = shopRing(BASE_R * 0.84, BAYS, SHOP_H, 0.34)
	shops.position.y = T1_Y
	g.add(shops)

	const awnings = awningRing(BASE_R * 0.84 + 0.22, BAYS, 0.34)
	awnings.position.y = T1_Y + SHOP_H * 0.78
	g.add(awnings)

	dressTerrace(BASE_R * 0.97, T1_Y, 20)

	// the shop roofs double as the floor of the terrace above
	const MID_R = BASE_R * 0.88
	const midFloor = new THREE.Mesh(
		new THREE.CylinderGeometry(MID_R * 1.06, MID_R * 1.06, 0.08, BAYS * 2),
		facet(STONE_LIGHT)
	)
	midFloor.position.y = T1_Y + SHOP_H + 0.04
	g.add(midFloor)

	// --- second terrace: gabled houses -----------------------------------
	const T2_Y = T1_Y + SHOP_H + 0.08
	const fence2 = railing(MID_R * 1.02, 0.22, BAYS * 3)
	fence2.position.y = T2_Y
	g.add(fence2)

	const houses = dormerRing(MID_R * 0.84, BAYS, 0.28)
	houses.position.y = T2_Y
	g.add(houses)

	dressTerrace(MID_R * 0.96, T2_Y, 16)

	// --- the glass dome over both terraces -------------------------------
	// the glass spans almost the whole upper terrace and sits shallow, so the
	// silhouette is a broad cap rather than a tower
	const SHELL_R = MID_R * 0.95
	const RISE = 0.62
	const shell = geodesicShell(SHELL_R, 2)
	shell.scale.y = RISE
	shell.position.y = T2_Y + 0.14
	g.add(shell)

	const crown = lantern(0.2)
	crown.position.y = T2_Y + 0.14 + SHELL_R * RISE - 0.05
	g.add(crown)

	// --- ground: entry stair, pergolas, planting -------------------------
	for (let i = 0; i < 4; i++) {
		const tread = new THREE.Mesh(
			new THREE.BoxGeometry(0.52 + i * 0.07, 0.05, 0.13),
			facet(i === 3 ? STONE : STONE_LIGHT)
		)
		tread.position.set(0, 0.1 - i * 0.032, BASE_R * 1.08 + i * 0.12)
		g.add(tread)
	}
	for (const side of [-1, 1]) {
		const porch = pergola(0.55, 0.44, 0.36)
		porch.position.set(side * BASE_R * 0.94, 0.1, BASE_R * 0.74)
		porch.rotation.y = side * -0.5
		g.add(porch)
		const pot = planter(rng)
		pot.position.set(side * 0.4, 0.1, BASE_R * 1.04)
		g.add(pot)
	}
	for (let i = 0; i < 22; i++) {
		const ang = rng.range(0, Math.PI * 2)
		const d = BASE_R * rng.range(1.03, 1.22)
		if (rng.chance(0.4)) {
			const boulder = new THREE.Mesh(
				displaceGeo(new THREE.DodecahedronGeometry(rng.range(0.13, 0.24), 0), rng, 0.05),
				facet(rng.chance(0.5) ? STONE : STONE_LIGHT)
			)
			boulder.position.set(Math.cos(ang) * d, 0.06, Math.sin(ang) * d)
			boulder.rotation.set(rng.next(), rng.next(), rng.next())
			g.add(boulder)
		} else if (rng.chance(0.5)) {
			const tree = topiary(rng)
			tree.position.set(Math.cos(ang) * d, 0.04, Math.sin(ang) * d)
			g.add(tree)
		} else {
			const plant = leafPlant(rng)
			plant.position.set(Math.cos(ang) * d, 0.04, Math.sin(ang) * d)
			plant.scale.setScalar(rng.range(0.85, 1.3))
			g.add(plant)
		}
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/* --- the base camp -------------------------------------------------------
 * What a founding crew actually needs before there are buildings: shelter,
 * a kitchen, a place to work, water and power, and a fire to sit around.
 * ------------------------------------------------------------------------ */

export type ContainerKind = 'KITCHEN' | 'WORKSHOP' | 'UTILITY' | 'STORAGE'

const CONTAINER_COLORS: Record<ContainerKind, string> = {
	KITCHEN: '#c4614a',
	WORKSHOP: '#3f6f93',
	UTILITY: '#5e8a6b',
	STORAGE: '#b6923f'
}

/**
 * A 12-metre shipping container, fitted out. Proportions are the real thing —
 * roughly five times as long as it is wide — with corrugated flanks, corner
 * castings and doors at one end, then whatever its job needs bolted on.
 */
export function shippingContainer(rng: Rng, kind: ContainerKind): THREE.Group {
	const g = new THREE.Group()
	const L = 2.44
	const H = 0.52
	const W = 0.49
	const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), facet(CONTAINER_COLORS[kind]))
	body.position.y = H / 2 + 0.03
	g.add(body)

	// corrugation: shallow ribs down both flanks, merged into one piece
	const ribGeos: THREE.BufferGeometry[] = []
	const ribs = 16
	for (let i = 0; i < ribs; i++) {
		const x = -L / 2 + 0.1 + (i * (L - 0.2)) / (ribs - 1)
		for (const side of [-1, 1]) {
			const rib = new THREE.BoxGeometry(0.045, H * 0.82, 0.03).toNonIndexed()
			rib.translate(x, H / 2 + 0.03, (side * W) / 2)
			ribGeos.push(rib)
		}
	}
	const ribsGeo = mergeGeometries(ribGeos, false)
	if (ribsGeo) {
		const tint = new THREE.Color(CONTAINER_COLORS[kind]).offsetHSL(0, 0, -0.05)
		g.add(new THREE.Mesh(ribsGeo, facet(tint)))
	}
	for (const rg of ribGeos) rg.dispose()

	// corner castings and a frame rail top and bottom
	const cornerGeos: THREE.BufferGeometry[] = []
	for (const sx of [-1, 1])
		for (const sy of [0, 1])
			for (const sz of [-1, 1]) {
				const c = new THREE.BoxGeometry(0.12, 0.1, 0.09).toNonIndexed()
				c.translate((sx * (L - 0.1)) / 2, 0.08 + sy * (H - 0.1), (sz * W) / 2)
				cornerGeos.push(c)
			}
	const corners = mergeGeometries(cornerGeos, false)
	if (corners) g.add(new THREE.Mesh(corners, facet('#6d6a63')))
	for (const cg of cornerGeos) cg.dispose()

	// doors at the far end
	for (const side of [-1, 1]) {
		const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, H * 0.82, W * 0.44), facet('#7d7a72'))
		door.position.set(-L / 2 - 0.01, H / 2 + 0.03, (side * W) / 4)
		g.add(door)
	}

	if (kind === 'KITCHEN') {
		// a serving hatch propped open, a counter under it, and a flue
		const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.34), facet('#e0d6bf'))
		hatch.position.set(0.3, H * 0.86, W / 2 + 0.15)
		hatch.rotation.x = -0.5
		g.add(hatch)
		const counter = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.18), facet(TIMBER))
		counter.position.set(0.3, H * 0.52, W / 2 + 0.08)
		g.add(counter)
		const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.42, 6), facet('#6d6a63'))
		flue.position.set(-0.55, H + 0.24, 0)
		g.add(flue)
		const cap = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 6), facet('#6d6a63'))
		cap.position.set(-0.55, H + 0.48, 0)
		g.add(cap)
	} else if (kind === 'WORKSHOP') {
		// a window band, an awning and a bench outside
		const band = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 0.03), facet('#9fd0dd'))
		band.position.set(0.2, H * 0.66, W / 2 + 0.005)
		g.add(band)
		const awning = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.03, 0.3), facet(TIMBER))
		awning.position.set(0.2, H * 0.92, W / 2 + 0.14)
		awning.rotation.x = -0.35
		g.add(awning)
		const bench = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.2), facet(TIMBER))
		bench.position.set(0.2, 0.18, W / 2 + 0.3)
		g.add(bench)
		for (const sx of [-1, 1]) {
			const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.16), facet(TIMBER_DARK))
			leg.position.set(0.2 + sx * 0.28, 0.08, W / 2 + 0.3)
			g.add(leg)
		}
	} else if (kind === 'STORAGE') {
		// the store: doors swung open, crates stacked out front under a tarp
		const swing = new THREE.Mesh(new THREE.BoxGeometry(0.03, H * 0.82, W * 0.44), facet('#7d7a72'))
		swing.position.set(-L / 2 - 0.12, H / 2 + 0.03, W * 0.42)
		swing.rotation.y = -0.9
		g.add(swing)

		const crateTone = ['#b98c52', '#a97c46', '#c69a5e']
		for (let i = 0; i < 5; i++) {
			const size = rng.range(0.16, 0.24)
			const crate = new THREE.Mesh(
				new THREE.BoxGeometry(size, size, size),
				facet(rng.pick(crateTone))
			)
			crate.position.set(
				-L / 2 - rng.range(0.2, 0.6),
				size / 2 + 0.03 + (i === 4 ? 0.2 : 0),
				rng.jitter(0, 0.28)
			)
			crate.rotation.y = rng.jitter(0, 0.4)
			g.add(crate)
		}
		const pallet = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.36), facet(TIMBER_DARK))
		pallet.position.set(0.7, 0.05, W / 2 + 0.3)
		g.add(pallet)
		const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8), facet('#6d8a6d'))
		drum.position.set(0.95, 0.15, W / 2 + 0.26)
		g.add(drum)
	} else {
		// water tank, solar panels and a run of pipes
		const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.86, 8), facet('#d9d5c8'))
		tank.rotation.z = Math.PI / 2
		tank.position.set(-0.55, H + 0.22, 0)
		g.add(tank)
		const panel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.42), facet('#2f3b4d'))
		panel.position.set(0.55, H + 0.13, 0)
		panel.rotation.z = 0.16
		g.add(panel)
		for (const sx of [-1, 1]) {
			const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), facet('#6d6a63'))
			strut.position.set(0.55 + sx * 0.45, H + 0.08, 0)
			g.add(strut)
		}
		const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), facet('#8a8f8c'))
		pipe.position.set(-0.98, H * 0.5, W / 2 + 0.06)
		g.add(pipe)
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/**
 * The camp's fire circle: a swept ring of ground, a stone hearth with a fire
 * big enough to gather round, and twelve log seats facing it — one per person
 * the tents sleep.
 */
export function fireCircle(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const SEATS = 12
	const SEAT_R = 1.85

	// swept ground, and a lighter hearth apron inside it
	const ground = new THREE.Mesh(
		new THREE.CylinderGeometry(SEAT_R + 0.42, SEAT_R + 0.46, 0.03, 20),
		facet('#c2b49a')
	)
	ground.position.y = 0.015
	g.add(ground)
	const apron = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.02, 16), facet('#a9967c'))
	apron.position.y = 0.03
	g.add(apron)

	// the hearth ring
	const stoneGeos: THREE.BufferGeometry[] = []
	const stones = 14
	for (let i = 0; i < stones; i++) {
		const a = (Math.PI * 2 * i) / stones + rng.jitter(0, 0.1)
		const stone = new THREE.DodecahedronGeometry(rng.range(0.12, 0.18), 0).toNonIndexed()
		stone.scale(1, 0.72, 1)
		stone.rotateY(rng.range(0, Math.PI))
		stone.translate(Math.cos(a) * 0.72, 0.07, Math.sin(a) * 0.72)
		stoneGeos.push(stone)
	}
	const hearth = mergeGeometries(stoneGeos, false)
	if (hearth) g.add(new THREE.Mesh(displaceGeo(hearth, rng, 0.02), facet('#9c968a')))
	for (const sg of stoneGeos) sg.dispose()

	// the fire: logs stacked into a teepee under a tall flame
	const logGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < 5; i++) {
		const a = (Math.PI * 2 * i) / 5 + rng.jitter(0, 0.2)
		const log = new THREE.CylinderGeometry(0.07, 0.09, 0.92, 6).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(a) * 0.24, 0.4, Math.sin(a) * 0.24)
		m.rotation.set(Math.cos(a) * 0.6, -a, Math.sin(a) * -0.6, 'YXZ')
		m.updateMatrix()
		log.applyMatrix4(m.matrix)
		logGeos.push(log)
	}
	for (let i = 0; i < 3; i++) {
		const log = new THREE.CylinderGeometry(0.09, 0.1, 1.0, 6).toNonIndexed()
		log.rotateZ(Math.PI / 2)
		log.rotateY((Math.PI * i) / 3 + rng.jitter(0, 0.2))
		log.translate(0, 0.1, 0)
		logGeos.push(log)
	}
	const logs = mergeGeometries(logGeos, false)
	if (logs) g.add(new THREE.Mesh(logs, facet('#9a6b40')))
	for (const lg of logGeos) lg.dispose()

	const FLAME = [
		{ r: 0.34, h: 0.6, y: 0.34, color: '#e86a2a', emissive: '#c9451a' },
		{ r: 0.25, h: 0.5, y: 0.62, color: '#f7a52c', emissive: '#e07b12' },
		{ r: 0.15, h: 0.36, y: 0.94, color: '#ffd76b', emissive: '#ffb020' }
	]
	for (const layer of FLAME) {
		const shard = new THREE.Mesh(
			displaceGeo(new THREE.ConeGeometry(layer.r, layer.h, 5), rng, 0.05),
			new THREE.MeshStandardMaterial({
				color: layer.color,
				emissive: layer.emissive,
				emissiveIntensity: 1.15,
				roughness: 0.6,
				metalness: 0,
				flatShading: true
			})
		)
		shard.position.y = layer.y
		shard.rotation.y = rng.range(0, Math.PI)
		g.add(shard)
	}

	// twelve log seats, each turned to face the fire
	const seatGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < SEATS; i++) {
		const a = (Math.PI * 2 * i) / SEATS + rng.jitter(0, 0.06)
		const seat = new THREE.CylinderGeometry(0.13, 0.14, 0.78, 7).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(a) * SEAT_R, 0.14, Math.sin(a) * SEAT_R)
		// lay the log TANGENTIALLY: a seat faces the fire across its length,
		// it does not point at it like a spoke
		m.rotation.set(Math.PI / 2, -a, 0, 'YXZ')
		m.updateMatrix()
		seat.applyMatrix4(m.matrix)
		seatGeos.push(seat)
	}
	const seats = mergeGeometries(seatGeos, false)
	if (seats) g.add(new THREE.Mesh(seats, facet('#a87a4c')))
	for (const sg of seatGeos) sg.dispose()

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

const VEHICLE_PAINT = ['#c9c4b8', '#5d7f96', '#a8574a', '#6f7f63', '#d8cdb4']

/** Four wheels under a body — shared by the camp's vehicles. */
function wheels(
	g: THREE.Group,
	opts: { wheelbase: number; track: number; radius: number; y: number }
): void {
	const geos: THREE.BufferGeometry[] = []
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) {
			const wheel = new THREE.CylinderGeometry(opts.radius, opts.radius, 0.08, 8).toNonIndexed()
			wheel.rotateX(Math.PI / 2)
			wheel.translate((sx * opts.wheelbase) / 2, opts.y, (sz * opts.track) / 2)
			geos.push(wheel)
		}
	const merged = mergeGeometries(geos, false)
	if (merged) g.add(new THREE.Mesh(merged, facet('#3a3833')))
	for (const geo of geos) geo.dispose()
}

/**
 * A pickup: cab forward, open bed behind, at the same scale as the
 * containers — roughly half their length, the way a truck is beside one.
 */
export function pickup(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const paint = rng.pick(VEHICLE_PAINT)
	const L = 1.12
	const W = 0.42

	const chassis = new THREE.Mesh(new THREE.BoxGeometry(L, 0.1, W), facet(paint))
	chassis.position.y = 0.17
	g.add(chassis)

	const cab = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, W * 0.96), facet(paint))
	cab.position.set(0.3, 0.32, 0)
	g.add(cab)

	const glass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, W * 0.86), facet('#8fb6c4'))
	glass.position.set(0.48, 0.34, 0)
	g.add(glass)

	// the open bed: floor plus three low walls
	const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, W * 0.94), facet('#6d6a63'))
	bedFloor.position.set(-0.24, 0.24, 0)
	g.add(bedFloor)
	for (const sz of [-1, 1]) {
		const side = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.12, 0.04), facet(paint))
		side.position.set(-0.24, 0.3, (sz * W * 0.94) / 2)
		g.add(side)
	}
	const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, W * 0.94), facet(paint))
	tail.position.set(-0.52, 0.3, 0)
	g.add(tail)

	if (rng.chance(0.6)) {
		const load = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.24), facet('#b98c52'))
		load.position.set(-0.28, 0.34, rng.jitter(0, 0.06))
		load.rotation.y = rng.jitter(0, 0.3)
		g.add(load)
	}

	wheels(g, { wheelbase: 0.72, track: W + 0.04, radius: 0.11, y: 0.11 })
	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** A box van: a tall cargo body with a short nose. */
export function van(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const paint = rng.pick(VEHICLE_PAINT)
	const L = 1.33
	const W = 0.46

	const body = new THREE.Mesh(new THREE.BoxGeometry(L * 0.7, 0.44, W), facet(paint))
	body.position.set(-0.18, 0.4, 0)
	g.add(body)

	const nose = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, W * 0.96), facet(paint))
	nose.position.set(0.4, 0.33, 0)
	g.add(nose)

	const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.17, W * 0.84), facet('#8fb6c4'))
	windshield.position.set(0.58, 0.38, 0)
	g.add(windshield)
	for (const sz of [-1, 1]) {
		const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.04), facet('#8fb6c4'))
		side.position.set(0.36, 0.38, (sz * W * 0.94) / 2)
		g.add(side)
	}

	// a band and rear doors, so the cargo box is not a blank slab
	const band = new THREE.Mesh(
		new THREE.BoxGeometry(L * 0.7 + 0.01, 0.06, W + 0.01),
		facet('#e8e2d4')
	)
	band.position.set(-0.18, 0.29, 0)
	g.add(band)
	for (const sz of [-1, 1]) {
		const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, W * 0.44), facet('#d8d2c4'))
		door.position.set(-0.65, 0.4, (sz * W) / 4)
		g.add(door)
	}

	wheels(g, { wheelbase: 0.86, track: W + 0.02, radius: 0.11, y: 0.11 })
	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** A tracked digger — the machine that shows up once a site starts building. */
export function digger(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const paint = rng.chance(0.5) ? '#d9a326' : '#c98b1f'

	// tracks
	for (const sz of [-1, 1]) {
		const track = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.2), facet('#3a3833'))
		track.position.set(0, 0.11, sz * 0.21)
		g.add(track)
	}

	const deck = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.5), facet('#4a4740'))
	deck.position.y = 0.25
	g.add(deck)

	// the house, turned a little off the tracks the way a parked digger sits
	const house = new THREE.Group()
	const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.26, 0.44), facet(paint))
	body.position.y = 0.13
	house.add(body)
	const cab = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.28), facet(paint))
	cab.position.set(0.12, 0.38, 0.06)
	house.add(cab)
	const glass = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.22), facet('#8fb6c4'))
	glass.position.set(0.25, 0.4, 0.06)
	house.add(glass)

	// boom, arm and bucket, folded in
	const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, 0.1), facet(paint))
	boom.position.set(0.3, 0.32, -0.14)
	boom.rotation.z = 0.55
	house.add(boom)
	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.08), facet(paint))
	arm.position.set(0.62, 0.42, -0.14)
	arm.rotation.z = -0.75
	house.add(arm)
	const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.18), facet('#6d6a63'))
	bucket.position.set(0.76, 0.14, -0.14)
	bucket.rotation.z = 0.4
	house.add(bucket)

	house.position.y = 0.3
	house.rotation.y = rng.jitter(0, 0.8)
	g.add(house)

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/**
 * The community stage: once a camp has permanent housing, the fire in the
 * middle becomes a place to gather properly — a raised timber platform under
 * a canopy, with a bench ring around it and a hearth still burning at the
 * front, because nobody gives that up.
 */
export function communityStage(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1.5

	// swept ground and the platform on it
	const ground = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 1.7, R * 1.74, 0.03, 20),
		facet('#c2b49a')
	)
	ground.position.y = 0.015
	g.add(ground)

	const plinth = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 1.02, R * 1.08, 0.16, 12),
		facet(STONE)
	)
	plinth.position.y = 0.08
	g.add(plinth)

	const deckTop = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.07, 12), facet(TIMBER))
	deckTop.position.y = 0.2
	g.add(deckTop)

	// plank seams, so the deck is not one flat disc
	const seamGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < 7; i++) {
		const seam = new THREE.BoxGeometry(R * 1.9, 0.01, 0.03).toNonIndexed()
		seam.translate(0, 0.24, -R * 0.82 + (i * R * 1.64) / 6)
		seamGeos.push(seam)
	}
	const seams = mergeGeometries(seamGeos, false)
	if (seams) g.add(new THREE.Mesh(seams, facet(TIMBER_DARK)))
	for (const sg of seamGeos) sg.dispose()

	// steps up the front
	for (let i = 0; i < 2; i++) {
		const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.18), facet(STONE_LIGHT))
		step.position.set(0, 0.16 - i * 0.06, R * 1.05 + i * 0.16)
		g.add(step)
	}

	// six posts carrying a shallow canopy
	const postGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI * 2 * i) / 6 + Math.PI / 6
		const post = new THREE.BoxGeometry(0.1, 0.95, 0.1).toNonIndexed()
		post.translate(Math.cos(a) * R * 0.86, 0.7, Math.sin(a) * R * 0.86)
		postGeos.push(post)
	}
	const posts = mergeGeometries(postGeos, false)
	if (posts) g.add(new THREE.Mesh(posts, facet(TIMBER)))
	for (const pg of postGeos) pg.dispose()

	const canopy = new THREE.Mesh(new THREE.ConeGeometry(R * 1.18, 0.42, 6), facet(TIMBER_DARK))
	canopy.position.y = 1.38
	canopy.rotation.y = Math.PI / 6
	g.add(canopy)
	const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), facet(TIMBER))
	finial.position.y = 1.62
	g.add(finial)

	// the hearth kept burning at the foot of the stage
	const hearth = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.1, 10), facet('#9c968a'))
	hearth.position.set(0, 0.05, R * 1.5)
	g.add(hearth)
	const FLAME = [
		{ r: 0.2, h: 0.34, y: 0.2, color: '#e86a2a', emissive: '#c9451a' },
		{ r: 0.13, h: 0.26, y: 0.38, color: '#ffd76b', emissive: '#ffb020' }
	]
	for (const layer of FLAME) {
		const shard = new THREE.Mesh(
			displaceGeo(new THREE.ConeGeometry(layer.r, layer.h, 5), rng, 0.03),
			new THREE.MeshStandardMaterial({
				color: layer.color,
				emissive: layer.emissive,
				emissiveIntensity: 1.15,
				roughness: 0.6,
				metalness: 0,
				flatShading: true
			})
		)
		shard.position.set(0, layer.y, R * 1.5)
		g.add(shard)
	}

	// benches facing the stage
	const benchGeos: THREE.BufferGeometry[] = []
	for (let i = 0; i < 10; i++) {
		const a = (Math.PI * 2 * i) / 10 + rng.jitter(0, 0.05)
		const bench = new THREE.BoxGeometry(0.62, 0.07, 0.16).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(a) * R * 1.45, 0.16, Math.sin(a) * R * 1.45)
		m.rotation.y = -a + Math.PI / 2
		m.updateMatrix()
		bench.applyMatrix4(m.matrix)
		benchGeos.push(bench)
		for (const sx of [-1, 1]) {
			const leg = new THREE.BoxGeometry(0.07, 0.13, 0.12).toNonIndexed()
			const lm = new THREE.Object3D()
			lm.position.set(
				Math.cos(a) * R * 1.45 - Math.sin(a) * sx * 0.24,
				0.07,
				Math.sin(a) * R * 1.45 + Math.cos(a) * sx * 0.24
			)
			lm.rotation.y = -a + Math.PI / 2
			lm.updateMatrix()
			leg.applyMatrix4(lm.matrix)
			benchGeos.push(leg)
		}
	}
	const benches = mergeGeometries(benchGeos, false)
	if (benches) g.add(new THREE.Mesh(benches, facet('#a87a4c')))
	for (const bg of benchGeos) bg.dispose()

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/* --- factories -----------------------------------------------------------
 * Where a settlement is a cluster of dwellings, a factory is ONE shell over
 * the same ground: a single storey of stone carrying a dome as wide as the
 * whole settlement cluster, glazed and panelled above.
 * ------------------------------------------------------------------------ */

export type FactoryKind = 'SOLAR'

/** Dark panels with glass between them — a roof that is mostly collector. */
const SOLAR_PANES = [
	'#1f2b3d',
	'#26344a',
	'#8fd3e8',
	'#1a2436',
	'#2b3a52',
	'#a5dced',
	'#22304a',
	'#1d2839'
]
const STEEL = '#8d949c'

/**
 * A factory dome: one storey of stone arcade, and above it a single shallow
 * dome spanning the whole footprint. The solar works wears its product —
 * the shell is mostly collector panels with glass let in between, and arrays
 * stand on the apron outside.
 */
export function factoryDome(rng: Rng, kind: FactoryKind): THREE.Group {
	const g = new THREE.Group()
	const R = 1
	const WALL_H = 0.34
	const BAYS = 18

	// the single storey it stands on
	g.add(arcadeDrum(rng, R, WALL_H, BAYS, 0.08))

	// a wide loading door, tall enough to read as a works entrance
	const doorway = new THREE.Mesh(new THREE.BoxGeometry(0.46, WALL_H * 0.82, 0.1), facet('#3f3a33'))
	doorway.position.set(0, WALL_H * 0.45, R * 1.0)
	g.add(doorway)
	for (const side of [-1, 1]) {
		const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.05, WALL_H * 0.88, 0.12), facet(STEEL))
		jamb.position.set(side * 0.25, WALL_H * 0.46, R * 1.0)
		g.add(jamb)
	}

	// the shell: wide and shallow, so it reads as a roof over a floor plate
	const DECK_Y = WALL_H + 0.15
	const shell = geodesicShell(R * 1.02, 2, {
		panes: kind === 'SOLAR' ? SOLAR_PANES : undefined,
		strut: STEEL,
		opacity: 0.9
	})
	shell.scale.y = 0.5
	shell.position.y = DECK_Y
	g.add(shell)

	// a ring of skylights around the crown, and a vent stack on top
	const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 8), facet(STEEL))
	crown.position.y = DECK_Y + R * 0.5 - 0.02
	g.add(crown)
	const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 6), facet(STEEL))
	stack.position.set(0.34, DECK_Y + R * 0.44, -0.2)
	g.add(stack)

	// solar arrays on the apron, angled at the sun
	const arrayGeos: THREE.BufferGeometry[] = []
	const frameGeos: THREE.BufferGeometry[] = []
	const rows = 5
	for (let i = 0; i < rows; i++) {
		const ang = Math.PI * 0.55 + (i / (rows - 1)) * Math.PI * 0.9 + rng.jitter(0, 0.04)
		const d = R * 1.2
		const panel = new THREE.BoxGeometry(0.44, 0.03, 0.22).toNonIndexed()
		const m = new THREE.Object3D()
		m.position.set(Math.cos(ang) * d, 0.16, Math.sin(ang) * d)
		m.rotation.set(-0.42, -ang, 0, 'YXZ')
		m.updateMatrix()
		panel.applyMatrix4(m.matrix)
		arrayGeos.push(panel)

		for (const sx of [-1, 1]) {
			const leg = new THREE.BoxGeometry(0.03, 0.16, 0.03).toNonIndexed()
			const lm = new THREE.Object3D()
			lm.position.set(
				Math.cos(ang) * d - Math.sin(ang) * sx * 0.18,
				0.08,
				Math.sin(ang) * d + Math.cos(ang) * sx * 0.18
			)
			lm.updateMatrix()
			leg.applyMatrix4(lm.matrix)
			frameGeos.push(leg)
		}
	}
	const arrays = mergeGeometries(arrayGeos, false)
	if (arrays) g.add(new THREE.Mesh(arrays, facet('#22304a')))
	const frames = mergeGeometries(frameGeos, false)
	if (frames) g.add(new THREE.Mesh(frames, facet(STEEL)))
	for (const geo of [...arrayGeos, ...frameGeos]) geo.dispose()

	// stock and crates by the door
	for (let i = 0; i < 6; i++) {
		const ang = rng.range(0, Math.PI * 2)
		const d = R * rng.range(1.08, 1.24)
		const size = rng.range(0.1, 0.16)
		const crate = new THREE.Mesh(
			new THREE.BoxGeometry(size, size * 0.7, size),
			facet(rng.chance(0.5) ? '#b98c52' : STEEL)
		)
		crate.position.set(Math.cos(ang) * d, size * 0.35 + 0.04, Math.sin(ang) * d)
		crate.rotation.y = rng.jitter(0, 0.5)
		g.add(crate)
	}

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}

/** Glass over green — the panes of a growing dome, not a dwelling. */
const GROW_GLASS = ['#a8dcc8', '#8fd3b4', '#c2e6d6', '#7ec9a8', '#b5e0cd', '#96d8bd']

/**
 * A growing dome: all glass over a low stone rim, with beds and crops inside
 * rather than apartments. Same size as a level 4 dwelling, so a works hex
 * reads at the same scale as a living one — but nobody lives here.
 */
export function growDome(rng: Rng): THREE.Group {
	const g = new THREE.Group()
	const R = 1

	// a low rim, not a storey: this is a greenhouse, not a building
	const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.04, R * 1.08, 0.16, 14), facet(STONE))
	rim.position.y = 0.08
	g.add(rim)
	const sill = new THREE.Mesh(
		new THREE.CylinderGeometry(R * 1.0, R * 1.0, 0.05, 14),
		facet(STONE_LIGHT)
	)
	sill.position.y = 0.18
	g.add(sill)

	// planting beds inside, visible through the glass
	const bedGeos: THREE.BufferGeometry[] = []
	const cropGeos: THREE.BufferGeometry[] = []
	for (let ring = 0; ring < 3; ring++) {
		const r = 0.28 + ring * 0.3
		const count = 6 + ring * 4
		for (let i = 0; i < count; i++) {
			const a = (Math.PI * 2 * i) / count + ring * 0.3
			const bed = new THREE.BoxGeometry(0.26, 0.05, 0.14).toNonIndexed()
			const m = new THREE.Object3D()
			m.position.set(Math.cos(a) * r, 0.22, Math.sin(a) * r)
			m.rotation.y = -a
			m.updateMatrix()
			bed.applyMatrix4(m.matrix)
			bedGeos.push(bed)

			const crop = new THREE.ConeGeometry(0.05, 0.16, 4).toNonIndexed()
			crop.translate(Math.cos(a) * r, 0.32, Math.sin(a) * r)
			cropGeos.push(crop)
		}
	}
	const beds = mergeGeometries(bedGeos, false)
	if (beds) g.add(new THREE.Mesh(beds, facet('#6b5138')))
	const crops = mergeGeometries(cropGeos, false)
	if (crops) g.add(new THREE.Mesh(crops, facet('#5f9c46')))
	for (const geo of [...bedGeos, ...cropGeos]) geo.dispose()

	const shell = geodesicShell(R, 2, { panes: GROW_GLASS, strut: '#cfc8ba', opacity: 0.42 })
	shell.scale.y = 0.72
	shell.position.y = 0.2
	g.add(shell)

	const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 8), facet('#cfc8ba'))
	vent.position.y = 0.2 + R * 0.72 - 0.02
	g.add(vent)

	g.rotation.y = rng.range(0, Math.PI * 2)
	return g
}
