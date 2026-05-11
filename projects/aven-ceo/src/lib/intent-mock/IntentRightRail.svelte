<script lang="ts">
import type { RightPanelTab } from './types'

const TABS: { id: RightPanelTab; label: string }[] = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'stream', label: 'Stream' },
	{ id: 'skills', label: 'Skills' }
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
	class="flex flex-col gap-2 w-full border-l border-border/50 pl-3 min-h-0 shrink-0 lg:w-[8.25rem]"
>
	<span class="text-[9px] font-bold opacity-25 uppercase tracking-wider mb-2 hidden lg:block"
		>Panel</span
	>
	<nav class="flex flex-row lg:flex-col gap-1">
		{#each TABS as item (item.id)}
			<button
				type="button"
				class="text-left px-2 py-2 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors {tab === item.id
					? 'bg-foreground text-background'
					: 'opacity-45 hover:opacity-90 hover:bg-foreground/5'}"
				onclick={() => onTab(item.id)}
			>
				{item.label}
			</button>
		{/each}
	</nav>
</aside>
