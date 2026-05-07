<script lang="ts">
import type { NodeProps } from '@xyflow/svelte'

/** Non-interactive backdrop behind serial Process rows (deterministic + creative grouped). */

export type SkillProcessBandNodeData = {
	groupTitle: string
	subtitle?: string
	widthPx: number
	heightPx: number
	variant?: 'orchestrator' | 'worker'
}

type Props = NodeProps & { data: SkillProcessBandNodeData }

let { data }: Props = $props()

function ringClass(): string {
	return data.variant === 'worker'
		? 'border-indigo-400/55 bg-white/25 shadow-inner ring-indigo-400/35'
		: 'border-indigo-600/55 bg-white/35 shadow-inner ring-indigo-800/38'
}

const titleAccent = $derived(data.variant === 'worker' ? 'text-indigo-900/92' : 'text-indigo-950')
</script>

<div
	class={`pointer-events-none select-none rounded-2xl border-2 px-4 py-2.5 ring-1 backdrop-blur-[2px] ${ringClass()}`}
	style={`width:${data.widthPx}px;min-height:${data.heightPx}px;`}
>
	<p class={`text-[10px] font-black uppercase tracking-[0.26em] ${titleAccent} opacity-80`}>
		Process group
	</p>
	<p class="mt-1 text-[13px] font-bold leading-snug tracking-tight text-indigo-950">
		{data.groupTitle}
	</p>
	{#if data.subtitle}
		<p class="mt-0.5 text-[11px] leading-snug text-indigo-900/82">{data.subtitle}</p>
	{/if}
</div>
