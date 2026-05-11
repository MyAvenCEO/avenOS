<script lang="ts">
import type { NodeProps } from '@xyflow/svelte'
import { Handle, Position } from '@xyflow/svelte'
import { getContext } from 'svelte'
import { BOARD_STEP_CONTEXT_KEY } from './board-flow-context'
import type { ProcessStepLifecycle } from './skill-playground-config'

export type AgentLaneRow = {
	readonly stepId: string
	readonly title: string
	readonly state: ProcessStepLifecycle
}

export type AgentLaneKind = 'human' | 'orchestrator' | 'worker'

export type SkillAgentLaneNodeData = {
	kind: AgentLaneKind
	readonly headline: string
	readonly rows: AgentLaneRow[]
	/** dashed tell→child downward */
	readonly delegatesDown?: boolean | undefined
	/** solid rollup to adjacent Report facet (right) */
	readonly hasReportOut?: boolean | undefined
	/** receive join-return from delegated child (↑) */
	readonly hasJoinTarget?: boolean | undefined
	/** worker completion back to parent join */
	readonly emitsJoinReturn?: boolean | undefined
	readonly sub?: string | undefined
}

type Props = NodeProps & { data: SkillAgentLaneNodeData }

let { data }: Props = $props()

/** Row state dot (Tailwind) per lifecycle */
const stateRowDot: Record<ProcessStepLifecycle, string> = {
	idle: 'bg-slate-400 ring-slate-500/35',
	running: 'bg-blue-500 ring-blue-700/35',
	blocked: 'bg-violet-500 ring-violet-800/38',
	success: 'bg-emerald-500 ring-emerald-700/32',
	error: 'bg-red-500 ring-red-900/42'
}

const pickStep = getContext<(id: string) => void>(BOARD_STEP_CONTEXT_KEY) ?? ((_id: string) => {})

function rowClick(stepId: string, e: MouseEvent) {
	e.stopPropagation()
	pickStep(stepId)
}

const shellClass = $derived(
	data.kind === 'human'
		? 'border-indigo-600/55 bg-white/92 ring-indigo-500/35'
		: data.kind === 'orchestrator'
			? 'border-sky-600/48 bg-white/93 ring-sky-500/38'
			: 'border-indigo-500/52 bg-indigo-50/[0.93] ring-indigo-500/32'
)

const portsClass = $derived(
	data.kind === 'human'
		? 'border-indigo-300/65 text-indigo-900/72'
		: 'border-sky-400/42 text-indigo-900/66'
)
</script>

<div
	class={`relative w-[min(100vw-2rem,296px)] max-w-[296px] rounded-2xl border-2 px-3 py-2 text-left shadow-md ring-1 ${shellClass}`}
	style="backdrop-filter: blur(10px)"
>
	{#if data.kind === 'human'}
		<Handle
			id="bubbleIn"
			type="target"
			position={Position.Top}
			class="!size-3 !border-indigo-500/45 !bg-indigo-50"
		/>
	{:else}
		<Handle
			id="inboxIn"
			type="target"
			position={Position.Top}
			class="!size-3 !border-sky-500/42 !bg-white"
		/>
	{/if}

	<div class="rounded-md border px-2 py-1 mb-2 {portsClass}">
		<div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
			<span class="font-mono text-[9px] font-bold uppercase tracking-widest whitespace-nowrap">
				In · ↓
			</span>
			{#if data.hasJoinTarget || data.emitsJoinReturn}
				<span class="font-mono text-[9px] font-bold uppercase tracking-wide text-indigo-800/82">
					join ↑
				</span>
			{/if}
			{#if data.delegatesDown}
				<span class="font-mono text-[9px] font-bold uppercase tracking-wide whitespace-nowrap">
					tell↓ child
				</span>
			{/if}
			{#if data.hasReportOut}
				<span class="font-mono text-[9px] font-bold uppercase tracking-widest"> Report → </span>
			{/if}
		</div>
	</div>

	{#if data.hasReportOut}
		<Handle
			id="rollupOut"
			type="source"
			position={Position.Right}
			class="!size-3 !border-indigo-500/52 !bg-indigo-50"
			style="top: 54px"
		/>
	{/if}

	{#if data.hasJoinTarget}
		<Handle
			id="joinFromChild"
			type="target"
			position={Position.Bottom}
			class="!size-3 !border-indigo-500/52 !bg-indigo-50/95"
			style="left: 38%"
		/>
	{/if}

	{#if data.delegatesDown}
		<Handle
			id="delegateDown"
			type="source"
			position={Position.Bottom}
			class="!size-3 !border-blue-950/42 !bg-white"
			style="left: 62%"
		/>
	{/if}

	{#if data.emitsJoinReturn}
		<Handle
			id="joinReturnOut"
			type="source"
			position={Position.Bottom}
			class="!size-3 !border-emerald-800/52 !bg-emerald-50"
			style="left: 50%"
		/>
	{/if}

	<p class="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/45">
		{data.kind === 'human' ? 'Human · inbox (root)' : data.kind === 'orchestrator' ? 'Agent' : 'Worker'}
	</p>
	<p class="mt-1 text-[13px] font-semibold leading-snug tracking-tight text-foreground">
		{data.headline}
	</p>
	{#if data.sub}
		<p class="mt-0.5 text-[10px] leading-snug text-foreground/55">{data.sub}</p>
	{/if}

	<div
		class="mt-2 space-y-px max-h-[220px] overflow-y-auto rounded-lg border border-foreground/[0.06] bg-black/[0.02] px-1.5 py-1"
	>
		{#if data.rows.length === 0}
			<p class="text-[11px] text-foreground/40 py-2 px-2">No Process rows in JSON preset</p>
		{:else}
			{#each data.rows as r (r.stepId)}
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] leading-snug hover:bg-indigo-500/11 cursor-pointer outline-none focus-visible:ring-2 ring-indigo-500/38"
					onclick={(e) => rowClick(r.stepId, e)}
				>
					<span
						class="size-2 shrink-0 rounded-full ring-2 {stateRowDot[r.state] ?? 'bg-muted'}"
					></span>
					<span class="min-w-0 flex-1 truncate text-foreground/90">{r.title}</span>
					<span class="shrink-0 font-mono text-[9px] uppercase tracking-wide text-foreground/50">
						{r.state}
					</span>
				</button>
			{/each}
		{/if}
	</div>

	{#if data.kind === 'human'}
		<Handle
			id="intentDown"
			type="source"
			position={Position.Bottom}
			class="!size-3 !border-indigo-500/52 !bg-indigo-50"
		/>
		<p class="mt-2 text-center text-[8px] font-bold uppercase tracking-[0.12em] text-indigo-800/54">
			bubble ↑ parent · intent ↓ stack
		</p>
	{/if}
</div>
