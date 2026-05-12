import type { Edge, Node } from '@xyflow/svelte'

import type { DebugActorEvent, DebugActorInfo, DebugActorSnapshot } from '../jaensen/types'

import { layoutGraph } from './layout'

export type ActorNodeData = { actor: DebugActorInfo }
export type ActorGraph = { nodes: Node<ActorNodeData>[]; edges: Edge[] }

const MESSAGE_TTL_MS = 800

export function snapshotToGraph(snapshot: DebugActorSnapshot): ActorGraph {
	const nodes = snapshot.actors.map((actor: DebugActorInfo) => ({
		id: actor.id,
		type: 'actor',
		position: { x: 0, y: 0 },
		data: { actor },
		width: 220,
		height: 72
	}))
	const edges = snapshot.actors
		.filter((actor: DebugActorInfo) => actor.parentId)
		.map((actor: DebugActorInfo) => ({
			id: `parent:${actor.parentId}:${actor.id}`,
			source: actor.parentId!,
			target: actor.id,
			animated: false,
			style: { stroke: 'rgba(120,120,120,0.45)' }
		}))
	return layoutGraph({ nodes, edges })
}

export function applyActorEvent(graph: ActorGraph, event: DebugActorEvent): ActorGraph {
	switch (event.type) {
		case 'ActorSpawned':
			return relayout(upsertActorNode(graph, event.actor))
		case 'ActorStateChanged':
			return {
				...graph,
				nodes: graph.nodes.map((node) =>
					node.id === event.actorId
						? {
							...node,
							data: { actor: { ...node.data.actor, status: event.status, currentTask: event.currentTask, lastEventAt: event.at } }
						}
						: node
				)
			}
		case 'ActorStopped':
			return relayout({
				...graph,
				nodes: graph.nodes.map((node) =>
					node.id === event.actorId
						? { ...node, data: { actor: { ...node.data.actor, status: 'stopped', lastEventAt: event.at } } }
						: node
				)
			})
		case 'MessageSent': {
			const transientEdge: Edge = {
				id: `message:${event.id}`,
				source: event.from,
				target: event.to,
				type: 'message',
				animated: true,
				data: { messageType: event.messageType, expiresAt: Date.now() + MESSAGE_TTL_MS },
				label: event.messageType
			}
			return {
				...graph,
				edges: pruneMessageEdges([...graph.edges.filter((edge) => edge.id !== transientEdge.id), transientEdge])
			}
		}
		case 'ActorTraceRecorded':
			return graph
	}

	return graph
}

function upsertActorNode(graph: ActorGraph, actor: DebugActorInfo): ActorGraph {
	const exists = graph.nodes.some((node) => node.id === actor.id)
	const nodes = exists
		? graph.nodes.map((node) => (node.id === actor.id ? { ...node, data: { actor } } : node))
		: [...graph.nodes, { id: actor.id, type: 'actor', position: { x: 0, y: 0 }, data: { actor }, width: 220, height: 72 }]
	const edges = actor.parentId && !graph.edges.some((edge) => edge.id === `parent:${actor.parentId}:${actor.id}`)
		? [...graph.edges, { id: `parent:${actor.parentId}:${actor.id}`, source: actor.parentId, target: actor.id }]
		: graph.edges
	return { nodes, edges }
}

function relayout(graph: ActorGraph): ActorGraph {
	return layoutGraph({
		nodes: graph.nodes,
		edges: graph.edges.filter((edge) => !String(edge.id).startsWith('message:'))
	})
}

function pruneMessageEdges(edges: Edge[]): Edge[] {
	const now = Date.now()
	return edges.filter((edge) => !String(edge.id).startsWith('message:') || ((edge.data as { expiresAt?: number } | undefined)?.expiresAt ?? 0) > now)
}