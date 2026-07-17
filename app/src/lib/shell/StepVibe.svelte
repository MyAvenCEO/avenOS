<script lang="ts">
import type { Flow, NodeState, RecipeNode, TraceStep } from '@avenos/aven-skills'
import TodosVibe from '$lib/shell/TodosVibe.svelte'
import VibeCard from '$lib/shell/VibeCard.svelte'

// board 0113 — ANY vibe schema renders from its DB vibe.* rows through the ONE generic VibeCard host
// (no allow-list); only the interactive todos `all` list keeps a dedicated component (CRUD events).

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

{#if vibe === 'todos'}
	<!-- the interactive todos list (CRUD events) keeps its dedicated engine component. board 0099. -->
	<TodosVibe />
{:else if vibe}
	<!-- board 0113 — every other schema renders its DB vibe rows through the generic host. -->
	<VibeCard schema={vibe} data={vibeData} />
{:else if !vibe && (!node || !step)}
	<div class="text-muted-foreground flex h-full items-center justify-center text-sm">
		Kein Schritt ausgewählt.
	</div>
{:else if node && step}
	<!-- Generic actor-step card: name · actor · mailbox → output · state. board 0099 actor hub. -->
	<div
		class="border-border bg-card flex h-full flex-col gap-4 rounded-[var(--radius-lg)] border p-6"
	>
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
					<span class="bg-primary/10 text-foreground rounded px-2 py-1 text-xs font-medium"
						>{o}</span
					>
				{/each}
			</div>
		</div>
		{#if step.message}
			<p
				class="text-muted-foreground border-border mt-auto rounded border border-dashed p-2 text-sm"
			>
				{step.message}
			</p>
		{/if}
	</div>
{:else}
	<!-- a vibe with no dedicated card AND no step: show the raw data so nothing is silently dropped. -->
	<div
		class="border-border bg-card mx-auto w-full max-w-md rounded-[var(--radius-lg)] border p-4 text-sm"
	>
		<p class="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wide uppercase">
			{vibe}
		</p>
		<pre
			class="text-foreground overflow-auto text-xs whitespace-pre-wrap"
		>{JSON.stringify(vibeData, null, 2)}</pre>
	</div>
{/if}
