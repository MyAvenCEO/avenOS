<script lang="ts">
import type { NodeProps } from '@xyflow/svelte'

import type { ActorNodeData } from './reducer'

const { data } = $props<NodeProps<ActorNodeData>>()

function tone(status: string): string {
	switch (status) {
		case 'running':
			return 'border-amber-400/60 bg-amber-50 text-amber-950'
		case 'failed':
			return 'border-red-400/60 bg-red-50 text-red-950'
		case 'stopped':
			return 'border-stone-400/60 bg-stone-50 text-stone-700'
		default:
			return 'border-emerald-400/40 bg-white text-foreground'
	}
}
</script>

<div class={`min-w-[220px] rounded-xl border px-3 py-2 shadow-sm ${tone(data.actor.status)}`}>
	<div class="flex items-start justify-between gap-2">
		<div>
			<p class="text-xs font-bold uppercase opacity-50">{data.actor.type}</p>
			<p class="text-sm font-semibold">{data.actor.name}</p>
			<p class="font-mono text-[10px] opacity-60">{data.actor.id}</p>
		</div>
		<span class="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-semibold uppercase">{data.actor.status}</span>
	</div>
	<div class="mt-2 grid grid-cols-2 gap-2 text-[11px] opacity-75">
		<div>mailbox: {data.actor.mailboxDepth}</div>
		<div>restarts: {data.actor.restartCount}</div>
	</div>
	{#if data.actor.currentTask}
		<p class="mt-2 text-[11px] opacity-75">task: {data.actor.currentTask}</p>
	{/if}
</div>