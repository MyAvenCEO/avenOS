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
}

export function layoutCoordinator(actors: Actor[], coordinatorId: string): MeshLayout {
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

	return {
		nodes,
		edges: wires.map((e, i) => ({
			id: `${e.from}-${e.functor}-${e.to}-${i}`,
			source: e.from,
			target: e.to,
			label: e.functor
		}))
	}
}
