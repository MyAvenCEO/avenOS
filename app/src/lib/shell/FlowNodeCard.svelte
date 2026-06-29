<script lang="ts">
import type { NodeState } from '@avenos/aven-vibes'
import { Handle, type NodeProps, Position } from '@xyflow/svelte'

// board 0083 — a Svelte Flow custom node = our actor-blackbox card (inbox → actor/sub-skill → output),
// with left/right handles for real edges. Optionally coloured by an instance run's node state + a
// selection ring so the graph doubles as a step-through explorer in the Runs tab.
type Port = { label: string; schema?: string }
type CardData = {
	name: string
	actor?: string
	composite: boolean
	subName?: string
	fanTag: string | null
	inputs: Port[]
	outputs: Port[]
	state?: NodeState
	selected?: boolean
}
let { data }: NodeProps = $props()
const d = $derived(data as unknown as CardData)

const STATE_BORDER: Record<NodeState, string> = {
	idle: '',
	waiting: 'border-amber-500/60',
	running: 'border-blue-500/70',
	done: 'border-green-600/60',
	error: 'border-red-600/60'
}
const STATE_DOT: Record<NodeState, string> = {
	idle: '',
	waiting: 'bg-amber-500',
	running: 'bg-blue-500',
	done: 'bg-green-600',
	error: 'bg-red-600'
}
</script>

<Handle type="target" position={Position.Left} class="!size-2 !border-0 !bg-muted-foreground/40" />
<div
	class="border-border bg-card w-52 overflow-hidden rounded-[var(--radius-lg)] border text-left {d.composite
		? 'border-primary/60 border-dashed'
		: d.state
			? STATE_BORDER[d.state]
			: ''} {d.selected ? 'ring-primary ring-2' : ''}"
>
	<div class="border-border/50 border-b px-2 py-1">
		<div class="flex flex-wrap gap-1">
			{#each d.inputs as r (r.label)}
				<span
					class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[9px] {r.schema
						? 'ring-primary/40 ring-1'
						: ''}"
					title={r.schema ? `Schema: ${r.schema}` : undefined}
					>{r.label}</span
				>
			{/each}
		</div>
	</div>
	<div class="flex items-center justify-between gap-2 px-2 py-1.5">
		<div class="min-w-0">
			<p class="text-foreground truncate text-xs font-semibold">{d.name}</p>
			{#if d.composite}
				<p class="text-primary truncate text-[9px]">▸ {d.subName}</p>
			{:else if d.actor}
				<p class="text-muted-foreground truncate font-mono text-[9px]">{d.actor}</p>
			{/if}
		</div>
		<span class="flex shrink-0 items-center gap-1">
			{#if d.composite}
				<span
					class="border-primary/60 text-primary rounded border border-dashed px-1 py-0.5 text-[8px] font-semibold"
					>Sub-Skill</span
				>
			{:else if d.fanTag}
				<span class="bg-primary/15 text-foreground rounded px-1 py-0.5 text-[8px] font-semibold"
					>{d.fanTag}</span
				>
			{/if}
			{#if d.state && d.state !== 'idle'}
				<span class="size-2 rounded-full {STATE_DOT[d.state]}"></span>
			{/if}
		</span>
	</div>
	<div class="border-border/50 bg-muted/20 border-t px-2 py-1">
		<div class="flex flex-wrap gap-1">
			{#each d.outputs as r (r.label)}
				<span
					class="bg-primary/10 text-foreground rounded px-1.5 py-0.5 text-[9px] {r.schema
						? 'ring-primary/40 ring-1'
						: ''}"
					title={r.schema ? `Schema: ${r.schema}` : undefined}
					>{r.label}</span
				>
			{/each}
		</div>
	</div>
</div>
<Handle type="source" position={Position.Right} class="!size-2 !border-0 !bg-muted-foreground/40" />
