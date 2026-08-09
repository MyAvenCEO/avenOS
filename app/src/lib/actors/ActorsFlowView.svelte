<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import ActorNode from './ActorNode.svelte'
import { type Actor, functor } from './actor'
import { bus } from './bus'

/**
 * The mesh, derived: every registered actor as a node, every edge the result
 * of unifying produces against requires. Nothing stored, nothing wired by
 * hand — this view is a compression of the registry, regenerated on every
 * render ("compression, not abstraction"). Tags filter the mesh into what
 * the old world would have called flows.
 *
 * Below the graph: the interview. Pick an actor, ask it anything — it
 * answers as itself, from its own manifest and live state.
 */

let tag = $state<string | null>(null)

const allTags = $derived([...new Set(bus.actors().flatMap((a) => a.manifest.tags))])

const shown = $derived(
	tag === null ? bus.actors() : bus.actors().filter((a) => a.manifest.tags.includes(tag as string))
)

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
	const name = functor(p)
	let h = 0
	for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997
	return PALETTE[h % PALETTE.length]
}

/** Solver stages give the x, order within a stage gives the y. */
const nodes = $derived.by<Node[]>(() => {
	const ids = new Set(shown.map((a) => a.manifest.id))
	const result: Node[] = []
	bus.stages().forEach((stage, x) => {
		let y = 0
		for (const actor of stage) {
			if (!ids.has(actor.manifest.id)) continue
			result.push({
				id: actor.manifest.id,
				type: 'actor',
				position: { x: x * 290, y: y * 190 },
				data: { actor, hue }
			})
			y++
		}
	})
	return result
})

const edges = $derived.by<Edge[]>(() => {
	const ids = new Set(shown.map((a) => a.manifest.id))
	return bus
		.edges()
		.filter((e) => ids.has(e.from) && ids.has(e.to))
		.map((e) => ({
			id: `${e.from}-${e.predicate}-${e.to}`,
			source: e.from,
			target: e.to,
			label: e.predicate,
			animated: true,
			style: 'stroke: rgba(30,41,59,0.25);',
			labelStyle: 'font-size: 10px; fill: rgba(30,41,59,0.5);'
		}))
})

const nodeTypes = { actor: ActorNode }

// ---- the interview box
let asking = $state<Actor | null>(null)
let question = $state('')
let answer = $state('')
let busy = $state(false)

async function ask(event: SubmitEvent) {
	event.preventDefault()
	if (!asking || question.trim() === '' || busy) return
	busy = true
	answer = ''
	try {
		answer = await bus.ask(asking.manifest.id, question)
	} finally {
		busy = false
	}
}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3 text-foreground">
	<div class="flex items-center gap-2">
		<!-- A "flow" is a tag over the mesh, not a stored thing. -->
		<div class="flex gap-0.5 rounded-full border border-border p-0.5 text-xs">
			<button
				type="button"
				onclick={() => {
					tag = null
				}}
				class="rounded-full px-3 py-1 transition-colors {tag === null
					? 'bg-primary text-primary-foreground'
					: 'opacity-60 hover:opacity-100'}"
			>
				Alle
			</button>
			{#each allTags as t (t)}
				<button
					type="button"
					onclick={() => {
						tag = t
					}}
					class="rounded-full px-3 py-1 transition-colors {tag === t
						? 'bg-primary text-primary-foreground'
						: 'opacity-60 hover:opacity-100'}"
				>
					{t}
				</button>
			{/each}
		</div>
		<span class="text-foreground/40 text-xs">
			{shown.length}
			Actors · Kanten hergeleitet aus produces → requires
		</span>
	</div>

	<div
		class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-foreground/5 bg-surface-soft/60"
	>
		<SvelteFlow {nodes} {edges} {nodeTypes} fitView proOptions={{ hideAttribution: true }}>
			<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
		</SvelteFlow>
	</div>

	<!-- The interview: the ask() protocol, human side. -->
	<div class="flex items-center gap-2">
		<div class="flex gap-0.5 rounded-full border border-border p-0.5 text-xs">
			{#each shown as actor (actor.manifest.id)}
				<button
					type="button"
					onclick={() => {
						asking = actor
						answer = ''
					}}
					class="rounded-full px-2.5 py-1 transition-colors {asking?.manifest.id ===
					actor.manifest.id
						? 'bg-primary text-primary-foreground'
						: 'opacity-60 hover:opacity-100'}"
				>
					{actor.manifest.name}
				</button>
			{/each}
		</div>
		<form onsubmit={ask} class="flex min-w-0 flex-1 items-center gap-2">
			<input
				bind:value={question}
				placeholder={asking ? `Frag ${asking.manifest.name}…` : 'Actor wählen, dann fragen…'}
				disabled={asking === null}
				class="min-w-0 flex-1 rounded-full border border-foreground/5 bg-[#fffdf7] px-4 py-2 text-sm shadow-[0_1px_3px_rgba(30,41,59,0.05)] outline-none placeholder:text-foreground/30 disabled:opacity-50"
			>
			<button
				type="button"
				onclick={(e) => e.currentTarget.closest('form')?.requestSubmit()}
				disabled={asking === null || question.trim() === '' || busy}
				class="rounded-full bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity disabled:opacity-30"
			>
				{busy ? '…' : 'Fragen'}
			</button>
		</form>
	</div>

	{#if answer}
		<p
			class="rounded-2xl border border-foreground/5 bg-[#fffdf7] px-4 py-3 text-sm leading-relaxed shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			{answer}
		</p>
	{/if}
</div>
