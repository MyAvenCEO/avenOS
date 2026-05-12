<script lang="ts">
import type { RightPanelTab } from './types'

const TABS: { id: RightPanelTab; label: string }[] = [
	{ id: 'todos', label: 'Todos' },
	{ id: 'stream', label: 'Stream' },
	{ id: 'config', label: 'Config' },
	{ id: 'context', label: 'Context' }
]

let {
	tab,
	onTab
}: {
	tab: RightPanelTab
	onTab: (t: RightPanelTab) => void
} = $props()
</script>

<aside
	class="flex flex-col gap-1.5 w-full border-l border-border/50 pl-2 min-h-0 shrink-0 xl:w-[5.5rem]"
>
	<span class="text-[8px] font-bold opacity-25 uppercase tracking-wider mb-1 hidden xl:block"
		>Panel</span
	>
	<nav class="flex flex-row xl:flex-col gap-0.5 xl:gap-1">
		{#each TABS as item (item.id)}
			<button
				type="button"
				class="text-left px-1.5 py-1.5 xl:px-2 rounded-md text-[9px] font-bold uppercase tracking-tight transition-colors {tab === item.id
					? 'bg-foreground text-background'
					: 'opacity-45 hover:opacity-90 hover:bg-foreground/5'}"
				onclick={() => onTab(item.id)}
			>
				{item.label}
			</button>
		{/each}
	</nav>
</aside>
