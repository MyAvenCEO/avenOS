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
	focus = false,
	onselect
}: {
	proof?: ProofStep | null
	selected?: Actor | null
	/** Ego view: the selected actor centered, only its direct partners shown. */
	focus?: boolean
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

/**
 * Focus: the ego graph. The selected actor sits centered; whoever feeds it
 * stands in the left column, whomever it feeds in the right. Clicking a
 * neighbor re-centers on it — that is the traversal: you walk the mesh one
 * relationship at a time.
 */
const ego = $derived.by(() => {
	if (!focus || !selected) return null
	const id = selected.manifest.id
	const feeders = new Set(
		bus
			.edges()
			.filter((e) => e.to === id)
			.map((e) => e.from)
	)
	const fed = new Set(
		bus
			.edges()
			.filter((e) => e.from === id)
			.map((e) => e.to)
	)
	// The tool channel counts as a relation: the chat reaches every actor
	// with methods, so those pairs belong in each other's ego view.
	if (id === 'chat') {
		for (const a of bus.actors()) {
			if (a.manifest.id !== 'chat' && a.manifest.methods.length > 0) fed.add(a.manifest.id)
		}
	} else if (selected.manifest.methods.length > 0 && bus.get('chat')) {
		feeders.add('chat')
	}
	return { id, feeders: [...feeders], fed: [...fed].filter((f) => !feeders.has(f)) }
})

const nodes = $derived.by<Node[]>(() => {
	const centerId = selected?.manifest.id
	const make = (actor: Actor, x: number, y: number): Node => {
		const verdict = verdicts ? (verdicts.get(actor.manifest.id) ?? ('idle' as const)) : null
		return {
			id: actor.manifest.id,
			type: 'actor',
			position: { x, y },
			data: { actor, hue, verdict, center: actor.manifest.id === centerId },
			selected: actor.manifest.id === centerId
		}
	}

	if (ego) {
		const result: Node[] = []
		const tallest = Math.max(ego.feeders.length, ego.fed.length, 1)
		const middle = ((tallest - 1) * 210) / 2
		ego.feeders.forEach((id, y) => {
			const actor = bus.get(id)
			if (actor) result.push(make(actor, 0, y * 210))
		})
		const center = bus.get(ego.id)
		if (center) result.push(make(center, 320, middle))
		ego.fed.forEach((id, y) => {
			const actor = bus.get(id)
			if (actor && !result.some((n) => n.id === id)) result.push(make(actor, 640, y * 210))
		})
		return result
	}

	const result: Node[] = []
	bus.stages().forEach((stage, x) => {
		stage.forEach((actor, y) => {
			result.push(make(actor, x * 300, y * 210))
		})
	})
	return result
})

const edges = $derived.by<Edge[]>(() => {
	const onPath = verdicts
	const shown = ego ? bus.edges().filter((e) => e.from === ego.id || e.to === ego.id) : bus.edges()
	const contractEdges: Edge[] = shown.map((e) => {
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

	// The tool channel, drawn as what it is: the chat can address every actor
	// that exposes methods, because its tool list derives from their
	// manifests. A different stroke from contract edges — envelopes, not
	// emits — and just as derived: nothing here is wired by hand either.
	const caller = bus.get('chat')
	const toolEdges: Edge[] = caller
		? bus
				.actors()
				.filter((a) => a.manifest.id !== 'chat' && a.manifest.methods.length > 0)
				.filter((a) => !ego || ego.id === 'chat' || ego.id === a.manifest.id)
				.map((a) => ({
					id: `tools-chat-${a.manifest.id}`,
					source: 'chat',
					target: a.manifest.id,
					label: `${a.manifest.methods.length} tools`,
					animated: false,
					style: 'stroke: rgba(30,41,59,0.3); stroke-dasharray: 6 4;',
					labelStyle: 'font-size: 10px; fill: rgba(30,41,59,0.4);'
				}))
		: []
	return [...contractEdges, ...toolEdges]
})

const nodeTypes = { actor: GraphNode }
</script>

<div
	class="h-[420px] shrink-0 overflow-hidden rounded-2xl border border-foreground/5 bg-surface-soft/60"
>
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
