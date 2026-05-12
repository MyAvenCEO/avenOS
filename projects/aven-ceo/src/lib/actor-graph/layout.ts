import dagre from '@dagrejs/dagre'

type GraphNode = { id: string; position?: { x: number; y: number }; width?: number; height?: number }
type GraphEdge = { id: string; source: string; target: string }

export function layoutGraph<TNode extends GraphNode, TEdge extends GraphEdge>(input: {
	nodes: TNode[]
	edges: TEdge[]
}): { nodes: TNode[]; edges: TEdge[] } {
	const graph = new dagre.graphlib.Graph()
	graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 56, marginx: 24, marginy: 24 })
	graph.setDefaultEdgeLabel(() => ({}))

	for (const node of input.nodes) {
		graph.setNode(node.id, { width: node.width ?? 220, height: node.height ?? 72 })
	}
	for (const edge of input.edges) {
		graph.setEdge(edge.source, edge.target)
	}

	dagre.layout(graph)

	return {
		nodes: input.nodes.map((node) => {
			const positioned = graph.node(node.id)
			return {
				...node,
				position: {
					x: positioned.x - (node.width ?? 220) / 2,
					y: positioned.y - (node.height ?? 72) / 2
				}
			}
		}),
		edges: input.edges
	}
}