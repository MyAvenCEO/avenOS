import { type Actor, edges as derivedEdges, find } from './model'

/**
 * Lay out ONE coordinator for the canvas — the direct port of the old
 * recipe layout onto the collapsed model. The decisive difference: the
 * edges laid out here are NOT read from anywhere, they are derived from
 * provides ∩ requires on the spot. The canvas draws an inference.
 *
 * Positions stay derived too: columns from graph depth (longest path
 * from a node nothing feeds), rows stacked within a column.
 */

export const NODE_W = 256
const COL_GAP = 90
const ROW_GAP = 40
const HEAD_H = 90
const PORT_H = 26

function nodeHeight(a: Actor): number {
	const m = a.manifest
	return HEAD_H + Math.max(m.requires?.length ?? 0, m.provides?.length ?? 0, 1) * PORT_H
}

export interface LaidOutNode {
	id: string
	position: { x: number; y: number }
	actor: Actor
}

export interface LaidOutEdge {
	id: string
	source: string
	target: string
	label: string
}

export interface MeshLayout {
	nodes: LaidOutNode[]
	edges: LaidOutEdge[]
	doors: Door[]
}

/**
 * A DOOR: the old handoff node, recovered as an inference. Coordinator
 * C hands to coordinator O iff C provides what O requires — the same
 * functor rule as every other wire, one level up. The canvas draws it
 * as a boundary tile; clicking walks into the receiving skill.
 */
export interface Door {
	id: string
	to: Actor
	functors: string[]
}

export function doors(actors: Actor[], coordinatorId: string, roots: Actor[]): Door[] {
	const c = find(actors, coordinatorId)
	if (!c) return []
	const provides = new Set(c.manifest.provides ?? [])
	return roots
		.filter((o) => o.id !== coordinatorId)
		.map((o) => ({
			id: `door:${o.id}`,
			to: o,
			functors: (o.manifest.requires ?? []).filter((f) => provides.has(f))
		}))
		.filter((d) => d.functors.length > 0)
}

export function layoutCoordinator(
	actors: Actor[],
	coordinatorId: string,
	roots: Actor[] = []
): MeshLayout {
	const coordinator = find(actors, coordinatorId)
	const members = (coordinator?.members ?? [])
		.map((id) => find(actors, id))
		.filter((a): a is Actor => a !== undefined)
	const wires = derivedEdges(actors, coordinatorId)

	// Longest path from any unfed node — the column an actor belongs in.
	const preds = new Map<string, string[]>()
	for (const e of wires) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from])
	const depth = new Map<string, number>()
	const walking = new Set<string>()
	const visit = (id: string): number => {
		const known = depth.get(id)
		if (known !== undefined) return known
		if (walking.has(id)) return 0
		walking.add(id)
		let d = 0
		for (const p of preds.get(id) ?? []) d = Math.max(d, visit(p) + 1)
		walking.delete(id)
		depth.set(id, d)
		return d
	}
	for (const a of members) visit(a.id)

	const columns: Actor[][] = []
	for (const a of members) {
		const c = depth.get(a.id) ?? 0
		if (!columns[c]) columns[c] = []
		columns[c].push(a)
	}
	const colHeight = columns.map(
		(col) => col.reduce((h, a) => h + nodeHeight(a), 0) + ROW_GAP * (col.length - 1)
	)
	const tallest = Math.max(...colHeight, 0)

	const nodes: LaidOutNode[] = []
	columns.forEach((col, c) => {
		const x = c * (NODE_W + COL_GAP)
		let y = (tallest - colHeight[c]) / 2
		for (const a of col) {
			nodes.push({ id: a.id, position: { x, y }, actor: a })
			y += nodeHeight(a) + ROW_GAP
		}
	})

	// The doors: one boundary tile per receiving skill, one column past
	// the members, wired from whichever member provides the functor.
	const exits = doors(actors, coordinatorId, roots)
	const doorX = columns.length * (NODE_W + COL_GAP)
	const doorH = (d: Door) => HEAD_H + Math.max(d.functors.length, 1) * PORT_H
	const doorsTotal = exits.reduce((h, d) => h + doorH(d), 0) + ROW_GAP * (exits.length - 1)
	let doorY = (tallest - doorsTotal) / 2
	const doorEdges: LaidOutEdge[] = []
	for (const d of exits) {
		nodes.push({ id: d.id, position: { x: doorX, y: doorY }, actor: d.to })
		doorY += doorH(d) + ROW_GAP
		for (const m of members) {
			const shared = (m.manifest.provides ?? []).filter((f) => d.functors.includes(f))
			for (const f of shared) {
				doorEdges.push({ id: `${m.id}-${f}-${d.id}`, source: m.id, target: d.id, label: f })
			}
		}
	}

	return {
		nodes,
		doors: exits,
		edges: [
			...wires.map((e, i) => ({
				id: `${e.from}-${e.functor}-${e.to}-${i}`,
				source: e.from,
				target: e.to,
				label: e.functor
			})),
			...doorEdges
		]
	}
}
