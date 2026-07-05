<script lang="ts">
import {
	EXAMPLE_FLOWS,
	type Flow,
	flowDepths,
	isComposite,
	type NodeState,
	RESOURCE_LABEL,
	type RecipeNode,
	resourceSchema
} from '@avenos/aven-skills'
import { Background, Controls, type Edge, MarkerType, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import FlowGroupBox from '$lib/shell/FlowGroupBox.svelte'
import FlowNodeCard from '$lib/shell/FlowNodeCard.svelte'

// board 0083 — reusable Svelte Flow canvas for a Flow template. Lays the DAG into columns
// (longest-path depth), renders our actor cards + real edges (with `when` labels), and optionally
// colours nodes by an instance run's per-node state + highlights the selected step. Shared by the
// Skills tab (templates) and the Runs tab (step-through explorer).
let {
	flow,
	nodeStates = {},
	selectedNodeId = null,
	onSelect,
	draggable = true,
	groups = {}
}: {
	flow: Flow | null
	nodeStates?: Record<string, NodeState>
	selectedNodeId?: string | null
	onSelect?: (id: string) => void
	draggable?: boolean
	/** prefix → label for the flattened sub-flow groups (e.g. `capture` → "Map Brain (Invoice)"). board 0094. */
	groups?: Record<string, string>
} = $props()

let nodes = $state.raw<Node[]>([])
let edges = $state.raw<Edge[]>([])
const nodeTypes = { recipe: FlowNodeCard, subflow: FlowGroupBox }

function resLabel(f: Flow, k: string): string {
	return f.resourceLabels?.[k] ?? RESOURCE_LABEL[k] ?? k
}
function fanTag(n: RecipeNode): string | null {
	if (n.inputs.length === 1 && n.outputs.length >= 2) return 'Fan-out'
	if (n.inputs.length >= 2 && n.outputs.length === 1) return 'Fan-in'
	return null
}
function flowName(id?: string): string {
	return (id && EXAMPLE_FLOWS.find((f) => f.id === id)?.name) || (id ?? '')
}

function buildGraph(
	f: Flow,
	states: Record<string, NodeState>,
	sel: string | null,
	grp: Record<string, string>
): { nodes: Node[]; edges: Edge[] } {
	const depth = flowDepths(f)
	const byCol: Record<number, RecipeNode[]> = {}
	for (const n of f.nodes) {
		const c = depth[n.id] ?? 0
		if (!byCol[c]) byCol[c] = []
		byCol[c].push(n)
	}
	const NODE_W = 208
	const COL_GAP = 110
	const ROW_H = 160
	const ns: Node[] = []
	for (const [colStr, arr] of Object.entries(byCol)) {
		const col = Number(colStr)
		arr.forEach((n, i) => {
			ns.push({
				id: n.id,
				type: 'recipe',
				position: { x: col * (NODE_W + COL_GAP), y: i * ROW_H },
				data: {
					name: n.name,
					actor: n.actor,
					composite: isComposite(n),
					subName: n.flowRef ? flowName(n.flowRef) : '',
					fanTag: fanTag(n),
					inputs: n.inputs.map((r) => ({ label: resLabel(f, r), schema: resourceSchema(r) })),
					outputs: n.outputs.map((r) => ({ label: resLabel(f, r), schema: resourceSchema(r) })),
					hitl: n.hitl,
					state: states[n.id],
					selected: sel === n.id
				}
			})
		})
	}
	const es: Edge[] = f.edges.map((e, i) => ({
		id: `${e.from}-${e.to}-${i}`,
		source: e.from,
		target: e.to,
		label: e.when,
		markerEnd: { type: MarkerType.ArrowClosed }
	}))
	// dotted sub-flow backdrops: one box wrapping the flattened steps of each parent group (id prefix),
	// so you can see which actors belong to which sub-flow. Rendered BEHIND the cards. board 0094.
	const PAD = 18
	const LABEL = 18
	const CARD_H = 134
	const groupNodes: Node[] = []
	for (const [prefix, label] of Object.entries(grp)) {
		const kids = ns.filter((n) => n.id.startsWith(`${prefix}/`))
		if (kids.length === 0) continue
		const minX = Math.min(...kids.map((k) => k.position.x))
		const minY = Math.min(...kids.map((k) => k.position.y))
		const maxX = Math.max(...kids.map((k) => k.position.x)) + NODE_W
		const maxY = Math.max(...kids.map((k) => k.position.y)) + CARD_H
		groupNodes.push({
			id: `group:${prefix}`,
			type: 'subflow',
			position: { x: minX - PAD, y: minY - PAD - LABEL },
			data: { label },
			selectable: false,
			draggable: false,
			zIndex: -1,
			style: `width:${maxX - minX + PAD * 2}px;height:${maxY - minY + PAD * 2 + LABEL}px`
		})
	}
	return { nodes: [...groupNodes, ...ns], edges: es }
}

// Rebuild when the flow, run states, or selection changes (positions stay deterministic = no jump).
$effect(() => {
	const f = flow
	const st = nodeStates
	const sel = selectedNodeId
	if (!f) {
		nodes = []
		edges = []
		return
	}
	const g = buildGraph(f, st, sel, groups)
	nodes = g.nodes
	edges = g.edges
})

function onNodeClick(e: unknown): void {
	const id = (e as { node?: { id?: string } })?.node?.id
	if (id) onSelect?.(id)
}
</script>

<SvelteFlow
	bind:nodes
	bind:edges
	{nodeTypes}
	fitView
	nodesConnectable={false}
	nodesDraggable={draggable}
	onnodeclick={onNodeClick}
>
	<Background />
	<Controls showLock={false} />
</SvelteFlow>
