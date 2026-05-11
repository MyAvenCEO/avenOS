<script lang="ts">
import type { NodeProps } from '@xyflow/svelte'
import { Handle, Position } from '@xyflow/svelte'
import type { ProcessStepLifecycle, SkillSerialStep } from './skill-playground-config'

export type SkillStepNodeData = {
	step: SkillSerialStep
	state: ProcessStepLifecycle
	delegatedChild?: boolean
}

type Props = NodeProps & { data: SkillStepNodeData }

let { data, targetPosition = Position.Left, sourcePosition = Position.Right }: Props = $props()

function stateBadge(c: ProcessStepLifecycle): string {
	switch (c) {
		case 'idle':
			return 'bg-slate-500/20 text-slate-900 ring-slate-500/30'
		case 'running':
			return 'bg-blue-500/25 text-blue-950 ring-blue-600/35'
		case 'blocked':
			return 'bg-violet-500/26 text-violet-950 ring-violet-600/38'
		case 'success':
			return 'bg-emerald-500/23 text-emerald-950 ring-emerald-600/35'
		case 'error':
			return 'bg-red-500/25 text-red-950 ring-red-500/40'
		default:
			return 'bg-muted'
	}
}

function dcBadge(kind: SkillSerialStep['kind']): string {
	return kind === 'deterministic'
		? 'bg-blue-950/12 text-blue-950 ring-blue-900/35'
		: 'bg-indigo-500/17 text-indigo-950 ring-indigo-600/38'
}

const dcLetter = $derived(data.step.kind === 'deterministic' ? 'D' : 'C')
</script>

<div
	class={`min-w-[210px] max-w-[268px] rounded-xl border border-border px-3 py-2.5 text-left shadow-md ring-1 ring-black/[0.05] ${data.delegatedChild ? 'bg-indigo-50/90' : 'bg-white/95'}`}
	style="backdrop-filter: blur(8px);"
>
	<Handle
		type="target"
		position={targetPosition}
		class="!size-3 !border-foreground/40 !bg-background"
		id="serial-in"
	/>
	<Handle
		type="target"
		position={Position.Bottom}
		class="!size-3 !border-indigo-500/35 !bg-white"
		id="join-in"
	/>

	<div class="flex items-start justify-between gap-2 pr-6">
		<span
			class={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ${dcBadge(data.step.kind)}`}
			title={data.step.kind}
		>
			{dcLetter}
		</span>
		<span
			class={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ${stateBadge(data.state)}`}
		>
			{data.state}
		</span>
	</div>
	{#if data.delegatedChild}
		<p class="mt-1.5 font-mono text-[9px] uppercase tracking-wide text-indigo-800/85">
			Child agent Process
		</p>
	{/if}
	<p class="mt-2 text-[13px] font-semibold leading-snug text-foreground">{data.step.title}</p>
	{#if data.step.kind === 'deterministic' && data.step.toolName}
		<p class="mt-1 font-mono text-[10px] text-foreground/55">
			tool:<span class="text-foreground/80">{data.step.toolName}</span>
		</p>
	{/if}
	{#if data.step.kind === 'creative'}
		{#if data.step.delegatesToChild}
			<p class="mt-1 font-mono text-[10px] text-indigo-900/85">
				<span class="text-foreground/50">delegates→</span>
				{data.step.delegatesToChild}
			</p>
		{/if}
		{#if data.step.llmPrompt}
			<p class="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/66">
				{data.step.llmPrompt}
			</p>
		{/if}
	{/if}

	<Handle
		type="source"
		position={sourcePosition}
		class="!size-3 !border-foreground/40 !bg-background"
		id="serial-out"
	/>
	<!-- delegate handle: outbound tell → child -->
	<Handle
		type="source"
		position={Position.Bottom}
		class="!size-3 !border-indigo-500/45 !bg-indigo-100"
		id="delegate-out"
	/>
</div>
