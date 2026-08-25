<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'
import type { FlowInstanceState, FlowNodeDef } from './skill'

/**
 * One workflow node as an n8n-style card: kind badge, name, one-line
 * subtitle, and the recipe ports — requires down the left, provides down
 * the right, exactly where the derived wires attach. Triggers wear the
 * green entrance look; a door is another skill standing in one dashed box.
 */
const {
	data
}: {
	data: {
		node: FlowNodeDef
		selected: boolean
		door?: boolean
		/** Instance overlay: this node's state in a RUNNING skill instance. */
		instance?: FlowInstanceState
		outputCount?: number
	}
} = $props()

const n = $derived(data.node)
const verb = $derived(n.type.split(':')[0])

/**
 * A node's instance overlay speaks the SAME state vocabulary as the intent
 * stream — a node that is running and an intent that is working are one
 * meaning, so they must not be two colours.
 */
const INSTANCE_RING: Record<FlowInstanceState, string> = {
	done: 'ring-2 ring-success/45',
	running: 'ring-2 ring-progress/40',
	waiting: 'ring-2 ring-foreground/15',
	retrying: 'ring-2 ring-warning/55',
	error: 'ring-2 ring-error/55',
	review: 'ring-2 ring-info/55',
	skipped: 'opacity-60 ring-1 ring-foreground/10'
}

/** Node KINDS are a categorical palette, not states — hence the roles vary. */
const BADGE: Record<string, string> = {
	trigger: 'bg-progress/12 text-progress-ink',
	llm: 'bg-error/12 text-error-ink',
	route: 'bg-warning/18 text-warning-ink',
	op: 'bg-quiet/15 text-quiet-ink',
	view: 'bg-primary/10 text-primary',
	human: 'bg-info/20 text-info-ink'
}
</script>

<div
	class="w-60 rounded-xl px-3.5 py-3 font-sans text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] transition-all {data.door
		? 'border-2 border-success/50 border-dashed bg-success/[0.05]'
		: n.kind === 'trigger'
			? 'border border-progress/60 bg-surface-raised'
			: 'border border-foreground/5 bg-surface-raised'} {data.selected
		? 'border-primary ring-2 ring-primary/20'
		: (data.instance && INSTANCE_RING[data.instance]) || ''}"
>
	<Handle type="target" position={Position.Left} />
	<div class="flex items-center gap-1.5 pb-1">
		<span
			class="rounded-md px-1.5 py-0.5 font-mono text-[0.625rem] {data.door
				? 'bg-success/12 text-success-ink'
				: (BADGE[verb] ?? BADGE.op)}"
		>
			{data.door ? 'skill' : verb}
		</span>
		<span class="font-medium text-sm leading-tight">{data.door ? `→ ${n.name}` : n.name}</span>
		{#if data.instance === 'done'}
			<!-- the instance overlay: this node already ran for the intent -->
			<span
				class="ml-auto flex size-4 items-center justify-center rounded-full bg-success text-success-foreground"
				title="erledigt"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-2.5"
					fill="none"
					stroke="currentColor"
					stroke-width="3.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="m5 13 4 4L19 7" />
				</svg>
			</span>
		{:else if data.instance === 'running'}
			<span class="ml-auto size-2 animate-pulse rounded-full bg-progress" title="läuft"></span>
		{:else if data.instance === 'retrying'}
			<span
				class="ml-auto size-2 animate-pulse rounded-full bg-warning"
				title="wird wiederholt"
			></span>
		{:else if data.instance === 'error'}
			<span
				class="ml-auto flex size-4 items-center justify-center rounded-full bg-error text-error-foreground"
				title="fehlgeschlagen"
				>×</span
			>
		{:else if data.instance === 'review'}
			<span class="ml-auto size-2 rounded-full bg-info" title="Prüfung nötig"></span>
		{:else if data.instance === 'skipped'}
			<span class="ml-auto text-foreground/35 text-xs" title="übersprungen">—</span>
		{:else if data.instance === 'waiting'}
			<span class="ml-auto size-2 rounded-full bg-foreground/20" title="wartet"></span>
		{:else if n.live}
			<span class="ml-auto size-1.5 rounded-full bg-success" title="live"></span>
		{/if}
	</div>
	<p class="pb-1.5 text-[0.6875rem] text-foreground/50 leading-snug">{n.about}</p>
	{#if data.outputCount}
		<p class="pb-1.5 font-mono text-[0.625rem] text-foreground/40">
			{data.outputCount} {data.outputCount === 1 ? 'Artefakt' : 'Artefakte'}
		</p>
	{/if}
	<div class="flex gap-2">
		<ul class="flex min-w-0 flex-1 flex-col items-start gap-1">
			{#each n.requires ?? [] as f (f)}
				<li
					class="max-w-full truncate rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					→ {f}
				</li>
			{/each}
		</ul>
		<ul class="flex min-w-0 flex-1 flex-col items-end gap-1">
			{#each n.provides ?? [] as f (f)}
				<li
					class="max-w-full truncate rounded-md bg-surface-cream px-1.5 py-0.5 font-mono text-[0.625rem]"
				>
					{f}
					→
				</li>
			{/each}
		</ul>
	</div>
	<Handle type="source" position={Position.Right} />
</div>
