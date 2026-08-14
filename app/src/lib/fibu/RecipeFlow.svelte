<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import RecipeFit from './RecipeFit.svelte'
import RecipeNode from './RecipeNode.svelte'
import { type Recipe, type RecipeNodeConfig, recipes } from './recipe-config'
import { layoutRecipe } from './recipe-layout'
import { skills } from './skill-config'

/**
 * The recipe explorer: a Node-RED-style canvas over pure JSON configs
 * (board 0132). One flow per screen — a subflow is a single violet,
 * dashed summary node, and clicking it walks into that flow's own canvas.
 * The breadcrumb is the way back up. Right: the selected step, readable by
 * default, its raw JSON one tab away. No engine yet: nothing here runs,
 * everything here is declared.
 */

// The id, never the recipe object: `$state` deep-proxies whatever it holds,
// and a proxied config would hand Svelte Flow proxied nodes — which it walks
// on every interaction. Holding ids keeps the configs plain.
let trail = $state<string[]>([recipes[0].id])
let selectedId = $state<string | null>(null)
let panelTab = $state<'details' | 'json'>('details')
let canvasW = $state(0)
let canvasH = $state(0)

const byId = new Map(recipes.map((r) => [r.id, r]))
const recipeId = $derived(trail[trail.length - 1])
const recipe = $derived<Recipe>(byId.get(recipeId) ?? recipes[0])
const laid = $derived(layoutRecipe(recipe))

const selectedNode = $derived(laid.nodes.find((n) => n.id === selectedId)?.node ?? null)
/** Absent capability is not "unknown" — it IS the strict default. */
const autonomie = $derived(
	selectedNode?.autonomie ?? {
		modus: 'hitl' as const,
		fehler: 'hitl' as const,
		freigabe: undefined
	}
)

/** Walk into a subflow — it becomes the canvas, and the trail grows. */
function enter(id: string) {
	if (byId.has(id)) {
		trail = [...trail, id]
		selectedId = null
	}
}

/** Jump anywhere in the trail, or start a different root from the chips. */
function goTo(index: number) {
	trail = trail.slice(0, index + 1)
	selectedId = null
}

function openRoot(id: string) {
	trail = [id]
	selectedId = null
}

/** A skill boundary: jump to where the receiving skill takes work in. */
function enterSkill(skillId: string) {
	const target = skills.find((s) => s.id === skillId)
	if (target) openRoot(target.entry)
}

const skillOf = $derived(skills.find((s) => s.flows.includes(recipeId)) ?? null)

function buildNodes(l: typeof laid, sel: string | null): Node[] {
	return l.nodes.map((n) => ({
		id: n.id,
		type: 'recipe',
		position: n.position,
		data: { node: n.node, selected: n.id === sel }
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

// Raw, deliberately: Svelte Flow walks these arrays on every interaction, and
// deep reactive proxies cost real frames — the library warns about it.
// Nothing mutates them in place; each change swaps a fresh array.
let nodes = $state.raw<Node[]>(buildNodes(layoutRecipe(recipes[0]), null))
let edges = $state.raw<Edge[]>(buildEdges(layoutRecipe(recipes[0]), null))
$effect.pre(() => {
	nodes = buildNodes(laid, selectedId)
	edges = buildEdges(laid, selectedId)
})

const nodeTypes = { recipe: RecipeNode }

const KIND_LABEL: Record<string, string> = {
	input: 'Input',
	transform: 'Transform',
	route: 'Route',
	hitl: 'HITL',
	subflow: 'Subflow',
	output: 'Output'
}

/** The step's config as it sits in the recipe file. */
function nodeJson(n: RecipeNodeConfig): string {
	return JSON.stringify(n, null, 2)
}

function configValue(v: unknown): string {
	return typeof v === 'string' ? v : JSON.stringify(v)
}
</script>

<div class="flex min-h-0 flex-1 gap-2">
	<!-- The library, grouped by skill: a skill is a named set of flows —
	     the unit aven installs and activates — and the flows inside it are
	     flat, shareable, and each openable as its own canvas. -->
	<nav
		class="flex w-56 shrink-0 flex-col overflow-y-auto rounded-2xl border border-border bg-surface-card/50"
	>
		<h3
			class="border-border border-b px-4 pt-3 pb-2 font-semibold text-foreground/50 text-xs uppercase tracking-wide"
		>
			Skills
		</h3>
		{#each skills as s (s.id)}
			<div class="border-border border-b px-4 pt-3 pb-1.5">
				<div class="flex items-baseline gap-1.5">
					<span class="font-semibold text-sm">{s.name}</span>
					{#if skillOf?.id === s.id}
						<span
							class="rounded-full bg-[#2f5d50]/12 px-1.5 py-0.5 font-mono text-[#2f5d50] text-[0.5625rem]"
						>
							aktiv
						</span>
					{/if}
				</div>
				<div class="pt-0.5 font-mono text-[0.625rem] text-foreground/40">
					{s.accepts.length > 0 ? `${s.accepts.join(', ')} → ` : ''}{s.provides.join(', ')}
				</div>
			</div>
			{#each s.flows as flowId (flowId)}
				{@const r = byId.get(flowId)}
				{#if r}
					{@const subs = r.nodes.filter((n) => n.kind === 'subflow').length}
					<button
						type="button"
						onclick={() => openRoot(r.id)}
						class="border-border/50 border-b px-4 py-2.5 text-left transition-colors {recipeId ===
						r.id
							? 'bg-surface-cream'
							: 'hover:bg-surface-card'}"
					>
						<div class="flex items-baseline gap-1.5">
							<span class="text-sm leading-snug">{r.name}</span>
							{#if s.entry === r.id}
								<span class="font-mono text-[0.5625rem] text-foreground/35">Eintritt</span>
							{/if}
						</div>
						<div class="pt-0.5 text-foreground/50 text-xs">
							{r.nodes.length}
							Schritte{subs > 0 ? ` · ${subs} Subflow${subs > 1 ? 's' : ''}` : ''}
						</div>
					</button>
				{/if}
			{/each}
		{/each}
	</nav>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
		<!-- The way back out of a subflow. Only once you went in. -->
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
						{byId.get(id)?.name ?? id}
					</button>
				{/each}
			</nav>
		{/if}
		<div
			bind:clientWidth={canvasW}
			bind:clientHeight={canvasH}
			class="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-surface-soft/60"
		>
			{#key recipeId}
				<SvelteFlow
					{nodes}
					{edges}
					{nodeTypes}
					fitView
					minZoom={0.15}
					proOptions={{ hideAttribution: true }}
					onnodeclick={({ node }) => {
						// Subflows and skill boundaries are doors: clicking one walks
						// through. Everything else selects, so the panel can explain it.
						const step = laid.nodes.find((n) => n.id === node.id)?.node
						if (step?.kind === 'subflow' && step.subflow) enter(step.subflow.recipe)
						else if (step?.kind === 'handoff' && step.handoff) enterSkill(step.handoff.skill)
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

	<!-- The selected step: readable first, the raw config one tab away —
	     both views of the same JSON, because the recipe IS the data. -->
	<aside
		class="flex w-96 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-card"
	>
		{#if selectedNode}
			<div class="border-border border-b px-4 pt-3 pb-2">
				<div class="flex items-baseline gap-2">
					<span class="font-semibold text-sm">{selectedNode.name}</span>
					<span class="font-mono text-[0.625rem] text-foreground/40">{selectedId}</span>
					<span class="ml-auto rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]">
						{KIND_LABEL[selectedNode.kind]}
					</span>
				</div>
				<p class="pt-1 text-foreground/60 text-xs leading-relaxed">{selectedNode.description}</p>
			</div>

			<nav class="flex gap-0.5 border-border border-b px-4 py-2">
				{#each [{ id: 'details' as const, label: 'Details' }, { id: 'json' as const, label: 'JSON' }] as t (t.id)}
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

			{#if panelTab === 'json'}
				<pre
					class="min-h-0 flex-1 overflow-auto p-4 font-mono text-[0.6875rem] leading-relaxed"
				>{nodeJson(
						selectedNode
					)}</pre>
			{:else}
				<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 text-xs">
					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							Transformation
						</h4>
						<div class="rounded-lg bg-surface-soft px-2.5 py-1.5 font-mono">
							{selectedNode.transform.type}
						</div>
						{#if Object.keys(selectedNode.transform.config).length > 0}
							<dl class="pt-2">
								{#each Object.entries(selectedNode.transform.config) as [key, value] (key)}
									<div class="flex gap-2 border-border/40 border-b py-1.5 last:border-0">
										<dt class="w-28 shrink-0 font-mono text-foreground/50">{key}</dt>
										<dd class="min-w-0 break-words font-mono">{configValue(value)}</dd>
									</div>
								{/each}
							</dl>
						{/if}
					</section>

					{#if selectedNode.llm}
						<section>
							<h4
								class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
							>
								LLM-Einsatz
							</h4>
							<p class="pb-1.5 leading-relaxed">{selectedNode.llm.purpose}</p>
							<ul class="flex flex-col gap-1">
								{#each selectedNode.llm.constraints as c (c)}
									<li class="rounded-lg bg-[#c15b40]/8 px-2.5 py-1.5 text-[#9c4832] leading-snug">
										{c}
									</li>
								{/each}
							</ul>
						</section>
					{:else}
						<section>
							<h4
								class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
							>
								LLM-Einsatz
							</h4>
							<p class="text-foreground/50 leading-relaxed">
								Keiner — dieser Schritt ist deterministisch.
							</p>
						</section>
					{/if}

					<!-- The actor capability. Absent is not "unknown" — it is the
					     strict default, and saying so is the whole point. -->
					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							Autonomie
						</h4>
						<div class="flex flex-wrap items-center gap-1.5">
							<span
								class="rounded-md px-2 py-1 font-mono {autonomie.modus === 'auto'
									? 'bg-[#2f5d50]/12 text-[#2f5d50]'
									: autonomie.modus === 'stichprobe'
										? 'bg-[#a06818]/12 text-[#a06818]'
										: 'bg-[#8a6238]/15 text-[#8a6238]'}"
							>
								{autonomie.modus}
							</span>
							<span class="text-foreground/50">Fehler → {autonomie.fehler}</span>
						</div>
						{#if autonomie.freigabe}
							<p class="pt-1.5 text-foreground/60 leading-relaxed">
								Freigegeben von <span class="font-mono">{autonomie.freigabe.durch}</span> seit
								<span class="font-mono">{autonomie.freigabe.seit}</span>
								— {autonomie.freigabe.nachweis}
							</p>
						{:else}
							<p class="pt-1.5 text-foreground/50 leading-relaxed">
								Nicht freigegeben — läuft unter Aufsicht, bis jemand ihn auf die Whitelist setzt.
							</p>
						{/if}
					</section>

					<section>
						<h4
							class="pb-1.5 font-semibold text-[0.625rem] text-foreground/50 uppercase tracking-wide"
						>
							Ports
						</h4>
						{#if selectedNode.inputs.length > 0}
							<div class="flex flex-wrap gap-1 pb-1.5">
								{#each selectedNode.inputs as port (port.name)}
									<span class="rounded-md bg-surface-soft px-2 py-1 font-mono">
										→ {port.name}{port.mode === 'any' ? ' · entweder/oder' : ''}
									</span>
								{/each}
							</div>
						{/if}
						{#if selectedNode.outputs.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each selectedNode.outputs as port (port.name)}
									<span class="rounded-md bg-surface-cream px-2 py-1 font-mono">
										{port.name}
										→
									</span>
								{/each}
							</div>
						{/if}
						{#if selectedNode.kind === 'route'}
							<p class="pt-1.5 text-foreground/50 leading-relaxed">
								Weiche: genau ein Ausgang feuert pro Element.
							</p>
						{/if}
					</section>
				</div>
			{/if}
		{:else}
			<div class="border-border border-b px-4 pt-3 pb-2">
				<div class="font-semibold text-sm">{recipe.name}</div>
				<p class="pt-1 text-foreground/60 text-xs leading-relaxed">{recipe.description}</p>
			</div>
			<div class="px-4 py-3 text-foreground/50 text-xs leading-relaxed">
				{recipe.nodes.filter((n) => n.kind === 'input').length}
				Inputs ·
				{recipe.nodes.filter((n) => n.kind === 'transform').length}
				Transforms ·
				{recipe.nodes.filter((n) => n.kind === 'subflow').length}
				Subflows ·
				{recipe.nodes.filter((n) => n.kind === 'output').length}
				Outputs ·
				{recipe.edges.length}
				Kanten
				<br><br>
				Einen Schritt anklicken für seine Details. Violett gestrichelte Kacheln sind ganze Flows —
				ein Klick geht hinein, die Breadcrumb wieder heraus.
			</div>
		{/if}
	</aside>
</div>
