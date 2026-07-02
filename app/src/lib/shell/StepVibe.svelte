<script lang="ts">
import type { Flow, NodeState, RecipeNode, TraceStep } from '@avenos/aven-skills'
import OntologyVibe from '$lib/shell/OntologyVibe.svelte'
import BundleVibe from '$lib/shell/BundleVibe.svelte'
import QueryVibe from '$lib/shell/QueryVibe.svelte'
import TodosVibe from '$lib/shell/TodosVibe.svelte'

// board 0083/0099 — the optional "vibe view" of a single flow step: a user-facing rendering of what an
// actor is doing. A step may name a `vibe` with `vibeData`; otherwise we key on `${flowId}:${nodeId}`
// for the Minecraft sand→glass demo, and fall back to a clean generic actor-step card. THE single
// per-step vibe component: used by Runs (pass a `step`) AND the chat (pass `vibe` + `data`). One
// renderer, no drift. board 0099 stripped the document/finance step cards — the actor hub renders
// generically; the one data skill (Todos) streams its own dedicated modes via TodosVibe.
let {
	flow = null,
	node = null,
	step = null,
	vibe: vibeProp = undefined,
	data: dataProp = undefined
}: {
	flow?: Flow | null
	node?: RecipeNode | null
	step?: TraceStep | null
	vibe?: string
	data?: Record<string, unknown>
} = $props()

const key = $derived(node && flow ? `${flow.id}:${node.id}` : '')
const running = $derived(step?.state === 'running')
const vibe = $derived(vibeProp ?? step?.vibe ?? '')
const vibeData = $derived((dataProp ?? step?.vibeData ?? {}) as Record<string, unknown>)

const STATE_LABEL: Record<NodeState, string> = {
	idle: 'Bereit',
	waiting: 'Wartet',
	running: 'Läuft',
	done: 'Fertig',
	error: 'Fehler',
	parked: 'Geparkt'
}
const STATE_CHIP: Record<NodeState, string> = {
	idle: 'bg-muted text-muted-foreground',
	waiting: 'bg-amber-500/15 text-amber-700',
	running: 'bg-blue-500/15 text-blue-700',
	done: 'bg-green-600/15 text-green-700',
	error: 'bg-red-600/15 text-red-700',
	parked: 'bg-purple-500/15 text-purple-700'
}
</script>

{#if vibe.startsWith('todos')}
	<!-- board 0099 — the Todos actor vibes render through TodosVibe everywhere (chat, Runs, Skills). -->
	<TodosVibe
		mode={(vibe === 'todos' ? 'all' : vibe.slice('todos-'.length)) as
			| 'all'
			| 'created'
			| 'edited'
			| 'deleted'}
		data={vibeData as { items?: { id?: string; title?: string }[]; diffs?: [] }}
	/>
{:else if vibe.startsWith('ontology')}
	<!-- board 0100 — the ontology actor vibes render through OntologyVibe (chat, Runs, Skills). -->
	<OntologyVibe mode={vibe === 'ontology' ? 'read' : 'created'} data={vibeData as never} />
{:else if vibe === 'query-result' || vibe === 'mutation-result'}
	<!-- board 0101 — the dynamic query/mutate actors render through QueryVibe (chat, Runs, Skills). -->
	<QueryVibe mode={vibe === 'query-result' ? 'query' : 'mutation'} data={vibeData as never} />
{:else if vibe === 'bundle-created'}
	<!-- board 0102 — the bundle actor (a new composite type) renders through BundleVibe. -->
	<BundleVibe data={vibeData as never} />
{:else if !vibe && (!node || !step)}
	<div class="text-muted-foreground flex h-full items-center justify-center text-sm">
		Kein Schritt ausgewählt.
	</div>
{:else if step && key === 'minecraft-glass:mine'}
	<!-- ⛏️ Sand abbauen -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8"
		style="background: linear-gradient(160deg,#e7d9b0,#cbb481)"
	>
		<div class="text-6xl">⛏️</div>
		<h3 class="text-2xl font-bold text-[#5a4a2a]">Sand abgebaut</h3>
		<div class="grid grid-cols-4 gap-1.5">
			{#each Array(8) as _, i (i)}
				<div class="size-9 rounded-sm border border-[#a8915f]" style="background:#ddc88f"></div>
			{/each}
		</div>
		{#each step.outputs ?? [] as o (o)}
			<span class="rounded-full bg-[#5a4a2a] px-4 py-1 text-sm font-semibold text-[#f3e9cf]"
				>⛏ {o}</span
			>
		{/each}
	</div>
{:else if step && key === 'minecraft-glass:smelt'}
	<!-- 🔥 Ofen -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8 text-[#ffe]"
		style="background: linear-gradient(160deg,#2b2b33,#16161b)"
	>
		<div class="text-6xl {running ? 'animate-pulse' : ''}">🔥</div>
		<h3 class="text-2xl font-bold">Schmelzen im Ofen</h3>
		<div class="flex items-center gap-3">
			<div class="flex flex-col items-center gap-1">
				{#each step.inputs ?? [] as i (i)}
					<span class="rounded bg-white/10 px-3 py-1 text-sm">{i}</span>
				{/each}
			</div>
			<span class="text-3xl text-orange-400">→</span>
			<div class="flex flex-col items-center gap-1">
				{#each step.outputs ?? [] as o (o)}
					<span class="rounded bg-sky-400/20 px-3 py-1 text-sm font-semibold text-sky-200"
						>🪟 {o}</span
					>
				{/each}
			</div>
		</div>
		<div class="h-2 w-56 overflow-hidden rounded-full bg-white/10">
			<div
				class="h-full rounded-full bg-gradient-to-r from-orange-500 to-yellow-300 {running
					? 'animate-pulse'
					: ''}"
				style="width: {running ? '70%' : '100%'}"
			></div>
		</div>
		{#if step.message}
			<p class="text-sm text-orange-200">{step.message}</p>
		{/if}
	</div>
{:else if step && key === 'minecraft-glass:craft-pane'}
	<!-- 🪟 Glasscheiben craften -->
	<div
		class="flex h-full flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] p-8"
		style="background: linear-gradient(160deg,#cfe6ef,#a9cfe0)"
	>
		<h3 class="text-2xl font-bold text-[#1f4a5c]">Glasscheiben craften</h3>
		<div class="grid grid-cols-3 gap-1 rounded-md bg-[#6b4a2a] p-2">
			{#each Array(9) as _, i (i)}
				<div
					class="size-10 rounded-sm border"
					style="background:{i < 6 ? 'rgba(180,220,235,.85)' : 'rgba(255,255,255,.25)'};border-color:#4a341f"
				></div>
			{/each}
		</div>
		<span class="text-2xl text-[#1f4a5c]">↓</span>
		{#each step.outputs ?? [] as o (o)}
			<span class="rounded-full bg-[#1f4a5c] px-4 py-1 text-sm font-semibold text-white">🪟 {o}</span
			>
		{/each}
		{#if step.message}
			<p class="text-sm text-[#1f4a5c]">{step.message}</p>
		{/if}
	</div>
{:else if node && step}
	<!-- Generic actor-step card: name · actor · mailbox → output · state. board 0099 actor hub. -->
	<div class="border-border bg-card flex h-full flex-col gap-4 rounded-[var(--radius-lg)] border p-6">
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<h3 class="text-foreground truncate text-lg font-semibold">{node.name}</h3>
				{#if node.actor}
					<p class="text-muted-foreground truncate font-mono text-[11px]">{node.actor}</p>
				{/if}
			</div>
			<span class="rounded-full px-2.5 py-1 text-xs font-semibold {STATE_CHIP[step.state]}"
				>{STATE_LABEL[step.state]}</span
			>
		</div>
		{#if node.note}
			<p class="text-muted-foreground text-sm">{node.note}</p>
		{/if}
		<div class="flex items-center gap-3">
			<div class="flex flex-1 flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
					>Inbox</span
				>
				{#each step.inputs ?? [] as i (i)}
					<span class="bg-muted text-foreground rounded px-2 py-1 text-xs">{i}</span>
				{/each}
			</div>
			<span class="text-muted-foreground text-2xl">→</span>
			<div class="flex flex-1 flex-col gap-1">
				<span class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase"
					>Output</span
				>
				{#each step.outputs ?? [] as o (o)}
					<span class="bg-primary/10 text-foreground rounded px-2 py-1 text-xs font-medium">{o}</span
					>
				{/each}
			</div>
		</div>
		{#if step.message}
			<p class="text-muted-foreground border-border mt-auto rounded border border-dashed p-2 text-sm">
				{step.message}
			</p>
		{/if}
	</div>
{:else}
	<!-- a vibe with no dedicated card AND no step: show the raw data so nothing is silently dropped. -->
	<div
		class="border-border bg-card mx-auto w-full max-w-md rounded-[var(--radius-lg)] border p-4 text-sm"
	>
		<p class="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wide uppercase">{vibe}</p>
		<pre
			class="text-foreground overflow-auto text-xs whitespace-pre-wrap">{JSON.stringify(vibeData, null, 2)}</pre>
	</div>
{/if}
