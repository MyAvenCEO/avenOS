<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import type { Actor } from './actor'
import { bus, type ProofStep } from './bus'
import GraphNode from './GraphNode.svelte'

/**
 * The mesh as a graph: nodes are actors, edges are derived by unifying
 * produces against requires, x comes from the forward solver's stages —
 * everything on screen is a compression of the registry, regenerated on
 * render.
 *
 * When a proof is passed in, the graph becomes the proof's picture: actors
 * carrying satisfied steps ring green, unsatisfied ring red, bystanders dim,
 * and the edges walked by the resolution glow.
 */
const {
	proof = null,
	selected = null,
	onselect
}: {
	proof?: ProofStep | null
	selected?: Actor | null
	onselect?: (actor: Actor) => void
} = $props()

/** A stable, calm palette; a functor hashes to one hue everywhere. */
const PALETTE = [
	'bg-[#d4a373]/20 text-[#8a6238]',
	'bg-[#7e6ead]/15 text-[#655687]',
	'bg-[#2f5d50]/12 text-[#2f5d50]',
	'bg-[#5b7a9d]/15 text-[#46617f]',
	'bg-[#c15b40]/12 text-[#9c4832]',
	'bg-[#a06818]/12 text-[#a06818]'
]

function hue(p: string): string {
	const name = p.slice(0, p.indexOf('(') === -1 ? undefined : p.indexOf('('))
	let h = 0
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
	return PALETTE[h % PALETTE.length]
}

/** Walk the proof tree: which actors carry which verdicts. */
const verdicts = $derived.by(() => {
	if (!proof) return null
	const map = new Map<string, 'satisfied' | 'unsatisfied'>()
	const walk = (step: ProofStep) => {
		if (step.actor) {
			// An unsatisfied step overrides a satisfied one on the same actor.
			const prior = map.get(step.actor)
			map.set(step.actor, !step.satisfied ? 'unsatisfied' : (prior ?? 'satisfied'))
		}
		for (const child of step.children) walk(child)
	}
	walk(proof)
	return map
})

const nodes = $derived.by<Node[]>(() => {
	const result: Node[] = []
	bus.stages().forEach((stage, x) => {
		stage.forEach((actor, y) => {
			const verdict = verdicts ? (verdicts.get(actor.manifest.id) ?? ('idle' as const)) : null
			result.push({
				id: actor.manifest.id,
				type: 'actor',
				position: { x: x * 300, y: y * 210 },
				data: { actor, hue, verdict },
				selected: selected?.manifest.id === actor.manifest.id
			})
		})
	})
	return result
})

const edges = $derived.by<Edge[]>(() => {
	const onPath = verdicts
	return bus.edges().map((e) => {
		const lit = onPath ? onPath.has(e.from) && onPath.has(e.to) : true
		return {
			id: `${e.from}-${e.predicate}-${e.to}`,
			source: e.from,
			target: e.to,
			label: e.predicate,
			animated: lit,
			style: lit
				? 'stroke: rgba(47,93,80,0.5); stroke-width: 1.5;'
				: 'stroke: rgba(30,41,59,0.12);',
			labelStyle: `font-size: 10px; fill: rgba(30,41,59,${lit ? 0.6 : 0.25});`
		}
	})
})

const nodeTypes = { actor: GraphNode }
</script>

<div class="h-[420px] shrink-0 overflow-hidden rounded-2xl border border-foreground/5 bg-surface-soft/60">
	<SvelteFlow
		{nodes}
		{edges}
		{nodeTypes}
		fitView
		proOptions={{ hideAttribution: true }}
		onnodeclick={({ node }) => {
			const actor = bus.get(node.id)
			if (actor && onselect) onselect(actor)
		}}
	>
		<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
	</SvelteFlow>
</div>
