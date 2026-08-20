<script lang="ts">
import { Handle, Position } from '@xyflow/svelte'

/**
 * One STATE as a canvas node — a kanban column made a circle in the automaton.
 * The initial state wears a ring, the terminal a double ring; the void marks
 * (entry/exit) are small and quiet. `compact` is the nested rendering: the
 * same circle, sized to live INSIDE a composite actor node on the unified
 * canvas.
 */
const {
	data
}: {
	data: {
		label: string
		kind: 'state' | 'entry' | 'exit'
		initial: boolean
		terminal: boolean
		compact?: boolean
	}
} = $props()
</script>

{#if data.kind === 'state'}
	<div
		class="flex flex-col items-center justify-center rounded-full border-2 bg-[#fffdf7] text-center font-medium text-foreground shadow-[0_1px_3px_rgba(30,41,59,0.06)] {data.compact
			? 'size-14 text-[0.6875rem]'
			: 'size-24 text-sm'} {data.terminal
			? 'border-[#2f5d50] ring-2 ring-[#2f5d50]/25 ring-offset-2 ring-offset-surface-soft'
			: data.initial
				? 'border-[#2f5d50]'
				: 'border-foreground/15'}"
	>
		<Handle type="target" position={Position.Left} />
		<Handle type="target" position={Position.Top} />
		<span>{data.label}</span>
		{#if !data.compact}
			{#if data.initial}
				<span class="font-mono text-[#2f5d50] text-[0.5625rem] uppercase tracking-wide">start</span>
			{:else if data.terminal}
				<span class="font-mono text-[#2f5d50] text-[0.5625rem] uppercase tracking-wide">end</span>
			{/if}
		{/if}
		<Handle type="source" position={Position.Right} />
		<Handle type="source" position={Position.Bottom} />
	</div>
{:else}
	<!-- The voids: where a task comes from (new) and goes to (gone). Small,
	     dashed, so they frame the machine without competing with the states. -->
	<div
		class="flex items-center justify-center rounded-full border border-foreground/20 border-dashed bg-surface-soft/60 font-mono text-foreground/45 uppercase {data.compact
			? 'size-6 text-[0.4375rem]'
			: 'size-10 text-[0.5625rem]'}"
	>
		<Handle type="target" position={Position.Left} />
		<Handle type="target" position={Position.Top} />
		{data.label}
		<Handle type="source" position={Position.Right} />
	</div>
{/if}
