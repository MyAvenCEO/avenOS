<script lang="ts">
import type { NodeProps } from '@xyflow/svelte'
import { Handle, Position } from '@xyflow/svelte'

export type ShellVariant = 'humanRoot' | 'inbox' | 'report'

export type SkillShellNodeData = {
	variant: ShellVariant
	headline?: string
	sub?: string
}

type Props = NodeProps & { data: SkillShellNodeData }

let { data, sourcePosition = Position.Right, targetPosition = Position.Left }: Props = $props()

const title = $derived(
	data.variant === 'humanRoot'
		? 'Human · Inbox (root)'
		: data.variant === 'inbox'
			? 'Inbox'
			: 'Report'
)

function shellClass(v: ShellVariant): string {
	switch (v) {
		case 'humanRoot':
			return 'border-indigo-500/55 bg-indigo-950/[0.12] ring-indigo-500/25 text-indigo-950'
		case 'inbox':
			return 'border-sky-500/45 bg-sky-950/[0.08] ring-sky-500/25 text-sky-950'
		case 'report':
			return 'border-indigo-400/55 bg-indigo-950/[0.1] ring-indigo-400/35 text-indigo-950'
		default:
			return 'border-border'
	}
}
</script>

<div
	class={`min-w-[138px] max-w-[220px] rounded-xl border px-3 py-2 text-left shadow-sm ring-1 ${shellClass(data.variant)}`}
>
	{#if data.variant === 'humanRoot'}
		<Handle
			id="bubbleIn"
			type="target"
			position={Position.Top}
			class="!size-3 !border-indigo-500/50 !bg-indigo-50"
		/>
		<Handle
			id="intentDown"
			type="source"
			position={Position.Bottom}
			class="!size-3 !border-indigo-500/50 !bg-indigo-100"
		/>
	{:else}
		{#if data.variant === 'inbox'}
			<Handle
				id="intentIn"
				type="target"
				position={Position.Top}
				class="!size-3 !border-sky-500/40 !bg-white"
			/>
		{/if}
		{#if data.variant === 'report'}
			<Handle
				id="serial-in"
				type="target"
				position={Position.Left}
				class="!size-3 !border-indigo-500/35 !bg-white"
			/>
			<Handle
				id="join-in"
				type="target"
				position={Position.Bottom}
				class="!size-3 !border-indigo-500/35 !bg-white"
			/>
		{/if}
		{#if data.variant !== 'report'}
			<Handle
				type="target"
				position={targetPosition}
				class="!size-3 !border-foreground/30 !bg-white"
			/>
		{/if}

		<Handle
			type="source"
			position={sourcePosition}
			class="!size-3 !border-foreground/40 !bg-background"
		/>
	{/if}

	{#if data.variant === 'report'}
		<Handle
			id="parentBubble"
			type="source"
			position={Position.Top}
			class="!size-3 !border-indigo-500/40 !bg-indigo-100"
		/>
	{/if}

	<p class="text-[10px] font-black uppercase tracking-[0.22em] text-foreground/50">{title}</p>
	{#if data.headline}
		<p class="mt-1 text-[12px] font-semibold leading-snug">{data.headline}</p>
	{/if}
	{#if data.sub}
		<p class="mt-1 text-[10px] leading-snug opacity-65">{data.sub}</p>
	{/if}

	{#if data.variant === 'humanRoot'}
		<p class="mt-1 font-mono text-[9px] opacity-55">bubble ↑ · intent ↓</p>
	{/if}
</div>
