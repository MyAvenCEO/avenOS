import type { Machine } from '../actors/machine'

/**
 * Lay a state machine out as the canonical automaton diagram: STATES are the
 * nodes, TRANSITIONS the directed labeled arrows — the reading that fits a
 * finite-state machine. Positions derived: states in a row along the cycle,
 * the void marks (entry/exit) bracketing them. Positions are normalized to
 * start at (0,0) and the bounding box is returned, so the same layout nests
 * INSIDE a composite actor node on the unified canvas (compact metrics) or
 * fills a whole panel (default metrics).
 */

export interface StateNode {
	id: string
	kind: 'state' | 'entry' | 'exit'
	label: string
	position: { x: number; y: number }
	initial: boolean
	terminal: boolean
}

export interface StateEdge {
	id: string
	source: string
	target: string
	label: string
}

export interface MachineLayout {
	nodes: StateNode[]
	edges: StateEdge[]
	/** Bounding box of the laid-out machine, for sizing a parent container. */
	width: number
	height: number
}

export interface MachineMetrics {
	col: number
	row: number
	stateSize: number
	voidSize: number
}

/** Full-panel metrics; `COMPACT` nests inside a composite actor node. */
export const FULL: MachineMetrics = { col: 240, row: 170, stateSize: 96, voidSize: 40 }
export const COMPACT: MachineMetrics = { col: 128, row: 96, stateSize: 56, voidSize: 24 }

/** Order the states along the cycle from the initial one; leftovers appended. */
function orderStates(m: Machine): string[] {
	const order: string[] = []
	const seen = new Set<string>()
	let cur: string | undefined = m.initial[0] ?? m.states[0]
	while (cur && !seen.has(cur)) {
		order.push(cur)
		seen.add(cur)
		cur = m.cycles.find((c) => c.from === cur && !seen.has(c.to))?.to
	}
	for (const s of m.states) if (!seen.has(s)) order.push(s)
	return order
}

export function layoutMachine(m: Machine, metrics: MachineMetrics = FULL): MachineLayout {
	const { col, row, stateSize, voidSize } = metrics
	const order = orderStates(m)
	const nodes: StateNode[] = order.map((s, i) => ({
		id: `state:${s}`,
		kind: 'state',
		label: s,
		position: { x: i * col, y: 0 },
		initial: m.initial.includes(s),
		terminal: m.terminal.includes(s)
	}))

	// The voids either side of the machine — only drawn if a transition uses them.
	const usesEntry = m.transitions.some((t) => t.from === 'none')
	const usesExit = m.transitions.some((t) => t.to === 'deleted')
	const centerX = ((order.length - 1) * col) / 2
	if (usesEntry) {
		nodes.unshift({
			id: 'entry',
			kind: 'entry',
			label: 'new',
			position: { x: -col * 0.75, y: (stateSize - voidSize) / 2 },
			initial: false,
			terminal: false
		})
	}
	if (usesExit) {
		nodes.push({
			id: 'exit',
			kind: 'exit',
			label: 'gone',
			position: { x: centerX + (stateSize - voidSize) / 2, y: row },
			initial: false,
			terminal: false
		})
	}

	// Normalize to (0,0) and measure, so a parent can wrap the machine tightly.
	const size = (n: StateNode) => (n.kind === 'state' ? stateSize : voidSize)
	const minX = Math.min(...nodes.map((n) => n.position.x))
	const minY = Math.min(...nodes.map((n) => n.position.y))
	for (const n of nodes) {
		n.position.x -= minX
		n.position.y -= minY
	}
	const width = Math.max(...nodes.map((n) => n.position.x + size(n)))
	const height = Math.max(...nodes.map((n) => n.position.y + size(n)))

	const nodeId = (s: string) => (s === 'none' ? 'entry' : s === 'deleted' ? 'exit' : `state:${s}`)
	const edges: StateEdge[] = m.transitions.map((t, i) => ({
		id: `${t.event}-${t.from}-${t.to}-${i}`,
		source: nodeId(t.from),
		target: nodeId(t.to),
		label: t.event
	}))

	return { nodes, edges, width, height }
}
