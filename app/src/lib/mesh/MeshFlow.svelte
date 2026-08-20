<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import RecipeFit from '../fibu/RecipeFit.svelte'
import MeshNode from './MeshNode.svelte'
import { layoutCoordinator } from './mesh-layout'
import { type Actor, ask, find } from './model'
import { registry } from './registry'

/**
 * The mesh canvas — the Node-RED-style view, recovered onto the
 * collapsed model. One coordinator per screen; a member that is itself
 * a coordinator is a dashed violet door, clicking walks in, the
 * breadcrumb walks back out. Every wire on screen is DERIVED from
 * provides ∩ requires at render time: the canvas draws an inference,
 * not a stored graph.
 */

const coordinators = registry.filter((a) => (a.members?.length ?? 0) > 0)
/** Top-level = not a member of any other coordinator. */
const roots = coordinators.filter((c) => !coordinators.some((o) => o.members?.includes(c.id)))

let trail = $state<string[]>([roots[0]?.id ?? coordinators[0].id])
let selectedId = $state<string | null>(null)
let panelTab = $state<'details' | 'manifest'>('details')
let canvasW = $state(0)
let canvasH = $state(0)

const currentId = $derived(trail[trail.length - 1])
const current = $derived(find(registry, currentId))
const laid = $derived(layoutCoordinator(registry, currentId))
const selected = $derived(laid.nodes.find((n) => n.id === selectedId)?.actor ?? null)

/** Absent autonomy is not "unknown" — it IS the strict default. */
const autonomy = $derived(
	selected?.manifest.autonomy ?? { mode: 'human' as const, onError: 'human' as const }
)

function enter(id: string) {
	trail = [...trail, id]
	selectedId = null
}
function goTo(index: number) {
	trail = trail.slice(0, index + 1)
	selectedId = null
}
function openRoot(id: string) {
	trail = [id]
	selectedId = null
}

function buildNodes(l: typeof laid, sel: string | null): Node[] {
	return l.nodes.map((n) => ({
		id: n.id,
		type: 'actor',
		position: n.position,
		data: { actor: n.actor, selected: n.id === sel }
	}))
}
function buildEdges(l: typeof laid, sel: string | null): Edge[] {
	return l.edges.map((e) => {
		const lit = sel === null ? true : e.source === sel || e.target === sel
		return {
			id: e.id,
			source: e.source,
			target: e.target,
			label: e.label,
			animated: lit && sel !== null,
			style: lit
				? 'stroke: rgba(47,93,80,0.5); stroke-width: 1.5;'
				: 'stroke: rgba(30,41,59,0.12);',
			labelStyle: `font-size: 10px; fill: rgba(30,41,59,${lit ? 0.6 : 0.25});`
		}
	})
}

// Raw, deliberately: Svelte Flow walks these arrays on every interaction.
let nodes = $state.raw<Node[]>([])
let edges = $state.raw<Edge[]>([])
$effect.pre(() => {
	nodes = buildNodes(laid, selectedId)
	edges = buildEdges(laid, selectedId)
})

const nodeTypes = { actor: MeshNode }

const actorJson = (a: Actor) => JSON.stringify(a, null, 2)
</script>

<div class="flex min-h-0 flex-1 gap-2">
	<!-- The declared population: top-level coordinators — what people call
	     skills — each openable as its own canvas. -->
	<nav
		class="flex w-56 shrink-0 flex-col overflow-y-auto rounded-2xl border border-border bg-surface-card/50"
	>
		<h3
			class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Skills <span class="font-normal normal-case opacity-60">· coordinator actors</span>
		</h3>
		{#each roots as c (c.id)}
			<button
				type="button"
				onclick={() => openRoot(c.id)}
				class="border-border/50 border-b px-4 py-2.5 text-left transition-colors {currentId ===
					c.id || trail.includes(c.id)
					? 'bg-surface-cream'
					: 'hover:bg-surface-card'}"
			>
				<div class="font-semibold text-sm">{c.manifest.name}</div>
				<div class="pt-0.5 font-mono text-[0.625rem] text-foreground/40">
					{(c.manifest.requires ?? []).join(' · ')}
					→ {(c.manifest.provides ?? []).join(' · ')}
				</div>
				<div class="pt-0.5 text-foreground/50 text-xs">
					{c.members?.length}
					members
					{#if c.members?.some((m) => (find(registry, m)?.members?.length ?? 0) > 0)}
						· nests deeper
					{/if}
				</div>
			</button>
		{/each}
		<p class="px-4 py-3 text-[0.625rem] text-foreground/40 leading-relaxed">
			One primitive. A skill is an actor with members; every wire on the canvas is derived from
			provides ∩ requires — nothing stores a graph.
		</p>
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
		{#if trail.length > 1}
			<nav class="flex flex-wrap items-center gap-1 px-1 text-foreground/50 text-xs">
				{#each trail as id, i (id + i)}
					{#if i > 0}
						<span class="opacity-40">/</span>
					{/if}
					<button
						type="button"
						onclick={() => goTo(i)}
						class="transition-colors hover:text-foreground {i === trail.length - 1
							? 'font-medium text-foreground'
							: 'underline underline-offset-4'}"
					>
						{find(registry, id)?.manifest.name ?? id}
					</button>
				{/each}
			</nav>
		{/if}
		<div
			bind:clientWidth={canvasW}
			bind:clientHeight={canvasH}
			class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface-soft/60"
		>
			{#key currentId}
				<SvelteFlow
					{nodes}
					{edges}
					{nodeTypes}
					fitView
					minZoom={0.15}
					proOptions={{ hideAttribution: true }}
					onnodeclick={({ node }) => {
						// A coordinator member is a door: clicking walks in.
						const actor = laid.nodes.find((n) => n.id === node.id)?.actor
						if ((actor?.members?.length ?? 0) > 0) enter(node.id)
						else selectedId = selectedId === node.id ? null : node.id
					}}
					onpaneclick={() => {
						selectedId = null
					}}
				>
					<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
					<RecipeFit w={canvasW} h={canvasH} />
				</SvelteFlow>
			{/key}
		</div>
	</div>

	<!-- The selected actor: readable first, the manifest one tab away —
	     the schema IS the object, and the object can explain itself. -->
	<aside
		class="flex w-96 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-card"
	>
		{#if selected}
			<div class="border-border border-b px-4 pt-3 pb-2">
				<div class="flex items-baseline gap-2">
					<span class="font-semibold text-sm">{selected.manifest.name}</span>
					<span class="font-mono text-[0.625rem] text-foreground/40">{selected.id}</span>
					<span class="ml-auto rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]">
						{selected.manifest.type ?? 'coordinator'}
					</span>
				</div>
				<p class="pt-1 text-foreground/60 text-xs leading-relaxed">{selected.manifest.about}</p>
			</div>

			<nav class="flex gap-0.5 border-border border-b px-4 py-2">
				{#each [{ id: 'details' as const, label: 'Details' }, { id: 'manifest' as const, label: 'Manifest' }] as t (t.id)}
					<button
						type="button"
						onclick={() => {
							panelTab = t.id
						}}
						class="rounded-full px-3 py-0.5 text-xs transition-colors {panelTab === t.id
							? 'bg-primary text-primary-foreground'
							: 'opacity-60 hover:opacity-100'}"
					>
						{t.label}
					</button>
				{/each}
			</nav>

			{#if panelTab === 'manifest'}
				<pre
					class="min-h-0 flex-1 overflow-auto p-4 font-mono text-[0.6875rem] leading-relaxed"
				>{actorJson(selected)}</pre>
			{:else}
				<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							ask()
						</h4>
						<pre
							class="whitespace-pre-wrap rounded-lg bg-surface-soft px-2.5 py-1.5 font-mono text-[0.6875rem] leading-relaxed"
						>{ask(selected)}</pre>
						<p class="pt-1.5 text-foreground/45 leading-relaxed">
							The ask-protocol fallback: without a model, the manifest answers as plain text.
						</p>
					</section>

					{#if selected.manifest.llm}
						<section>
							<h4
								class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
							>
								LLM
							</h4>
							<p class="pb-1.5 leading-relaxed">{selected.manifest.llm.purpose}</p>
							<ul class="flex flex-col gap-1">
								{#each selected.manifest.llm.constraints ?? [] as c (c)}
									<li class="rounded-lg bg-[#c15b40]/8 px-2.5 py-1.5 text-[#9c4832] leading-snug">
										{c}
									</li>
								{/each}
							</ul>
						</section>
					{/if}

					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							Autonomy
						</h4>
						<div class="flex flex-wrap items-center gap-1.5">
							<span
								class="rounded-md px-2 py-1 font-mono {autonomy.mode === 'auto'
									? 'bg-[#2f5d50]/12 text-[#2f5d50]'
									: autonomy.mode === 'sample'
										? 'bg-[#a06818]/12 text-[#a06818]'
										: 'bg-[#8a6238]/15 text-[#8a6238]'}"
							>
								{autonomy.mode}
							</span>
							<span class="text-foreground/50">on error → {autonomy.onError}</span>
						</div>
						{#if autonomy.granted}
							<p class="pt-1.5 text-foreground/60 leading-relaxed">
								Granted by <span class="font-mono">{autonomy.granted.by}</span> since
								<span class="font-mono">{autonomy.granted.since}</span>
								— {autonomy.granted.evidence}
							</p>
						{:else}
							<p class="pt-1.5 text-foreground/50 leading-relaxed">
								Not granted — runs supervised until someone whitelists it.
							</p>
						{/if}
					</section>

					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							Capabilities
						</h4>
						{#if (selected.manifest.requires ?? []).length > 0}
							<div class="flex flex-wrap gap-1 pb-1.5">
								{#each selected.manifest.requires ?? [] as f (f)}
									<span class="rounded-md bg-surface-soft px-2 py-1 font-mono">→ {f}</span>
								{/each}
							</div>
						{/if}
						{#if (selected.manifest.provides ?? []).length > 0}
							<div class="flex flex-wrap gap-1">
								{#each selected.manifest.provides ?? [] as f (f)}
									<span class="rounded-md bg-surface-cream px-2 py-1 font-mono">{f} →</span>
								{/each}
							</div>
						{/if}
					</section>
				</div>
			{/if}
		{:else}
			<div class="border-border border-b px-4 pt-3 pb-2">
				<div class="font-semibold text-sm">{current?.manifest.name}</div>
				<p class="pt-1 text-foreground/60 text-xs leading-relaxed">{current?.manifest.about}</p>
			</div>
			<div class="px-4 py-3 text-foreground/50 text-xs leading-relaxed">
				{laid.nodes.length}
				member actors · {laid.edges.length} derived wires
				<br><br>
				Click an actor for its manifest. Dashed violet tiles are whole coordinators — one click
				walks in, the breadcrumb walks back out. Every wire is inferred from provides ∩ requires,
				never stored.
			</div>
		{/if}
	</aside>
</div>
