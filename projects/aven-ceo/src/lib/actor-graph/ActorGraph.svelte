<script lang="ts">
import { onMount } from 'svelte'
import { Background, Controls, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'

import type { DebugActorEvent, DebugActorSnapshot } from '../jaensen/types'

import ActorNode from './ActorNode.svelte'
import MessageEdge from './MessageEdge.svelte'
import { applyActorEvent, snapshotToGraph, type ActorGraph } from './reducer'

let nodes = $state<ActorGraph['nodes']>([])
let edges = $state<ActorGraph['edges']>([])

const nodeTypes = { actor: ActorNode } as Record<string, typeof ActorNode>
const edgeTypes = { message: MessageEdge } as Record<string, typeof MessageEdge>

onMount(() => {
	let source: EventSource | null = null
	void fetch('/api/aven/jaensen/debug/actors')
		.then(async (response) => {
			if (!response.ok) {
				throw new Error(`Failed to load actor snapshot: ${response.status}`)
			}
			return response.json()
		})
		.then((snapshot: DebugActorSnapshot) => {
			const graph = snapshotToGraph(snapshot)
			nodes = graph.nodes
			edges = graph.edges
		})
		.catch((error) => {
			console.error('Failed to initialize actor graph', error)
			nodes = []
			edges = []
		})

	source = new EventSource('/api/aven/jaensen/debug/actors/events')
	for (const type of ['ActorSpawned', 'ActorStateChanged', 'MessageSent', 'ActorStopped', 'ActorTraceRecorded']) {
		source.addEventListener(type, (raw) => {
			const event = JSON.parse((raw as MessageEvent<string>).data) as DebugActorEvent
			const graph = applyActorEvent({ nodes, edges }, event)
			nodes = graph.nodes
			edges = graph.edges
		})
	}

	return () => source?.close()
})
</script>

<div class="h-[calc(100vh-7rem)] w-full rounded-xl border border-border/50 bg-background/70">
	<SvelteFlow {nodes} {edges} {nodeTypes} {edgeTypes} fitView>
		<Background />
		<Controls />
	</SvelteFlow>
</div>