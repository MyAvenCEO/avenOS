/**
 * Lay out ONE recipe for the canvas.
 *
 * A subflow is drawn as a single summary node carrying its own ports — you
 * see that a flow sits there, not its innards. Clicking it navigates into
 * that recipe's own canvas, so every screen shows exactly one flow's steps
 * (composite–leaf, one level at a time). That is what keeps a four-level
 * composition readable.
 *
 * Positions are DERIVED, never authored: columns come from graph depth
 * (longest path from an input), rows stack within a column, and each column
 * is as wide as its widest member — the same idea `ActorGraph` uses with the
 * solver's stages.
 */
import type { Recipe, RecipeNodeConfig } from './recipe-config'

export const NODE_W = 256
const COL_GAP = 90
const ROW_GAP = 40
/** Header, transform line, and one row per port — the taller side wins. */
const HEAD_H = 90
const PORT_H = 26

function nodeHeight(n: RecipeNodeConfig): number {
	return HEAD_H + Math.max(n.inputs.length, n.outputs.length, 1) * PORT_H
}

export interface LaidOutNode {
	id: string
	position: { x: number; y: number }
	node: RecipeNodeConfig
}

export interface LaidOutEdge {
	id: string
	source: string
	target: string
	label: string
}

export interface RecipeLayout {
	nodes: LaidOutNode[]
	edges: LaidOutEdge[]
	width: number
	height: number
}

/** Longest path from any input — the column a node belongs in. */
function depths(recipe: Recipe): Map<string, number> {
	const preds = new Map<string, string[]>()
	for (const e of recipe.edges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from])
	const depth = new Map<string, number>()
	const walking = new Set<string>()
	const visit = (id: string): number => {
		const known = depth.get(id)
		if (known !== undefined) return known
		// Guarded, though the recipes are asserted acyclic.
		if (walking.has(id)) return 0
		walking.add(id)
		let d = 0
		for (const p of preds.get(id) ?? []) d = Math.max(d, visit(p) + 1)
		walking.delete(id)
		depth.set(id, d)
		return d
	}
	for (const n of recipe.nodes) visit(n.id)
	return depth
}

export function layoutRecipe(recipe: Recipe): RecipeLayout {
	const depth = depths(recipe)
	const columns: RecipeNodeConfig[][] = []
	for (const n of recipe.nodes) {
		const c = depth.get(n.id) ?? 0
		if (!columns[c]) columns[c] = []
		columns[c].push(n)
	}

	const colHeight = columns.map(
		(col) => col.reduce((h, n) => h + nodeHeight(n), 0) + ROW_GAP * (col.length - 1)
	)
	const tallest = Math.max(...colHeight, 0)

	const nodes: LaidOutNode[] = []
	columns.forEach((col, c) => {
		const x = c * (NODE_W + COL_GAP)
		let y = (tallest - colHeight[c]) / 2
		for (const n of col) {
			nodes.push({ id: n.id, position: { x, y }, node: n })
			y += nodeHeight(n) + ROW_GAP
		}
	})

	const edges: LaidOutEdge[] = recipe.edges.map((e) => ({
		id: e.id,
		source: e.from,
		target: e.to,
		label: e.fromPort
	}))

	return {
		nodes,
		edges,
		width: Math.max(columns.length * (NODE_W + COL_GAP) - COL_GAP, 0),
		height: tallest
	}
}
