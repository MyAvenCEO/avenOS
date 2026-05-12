<script lang="ts">
import type { ActorContextTab } from './types'

let {
	tabs,
	tab,
	onTab
}: {
	tabs: { id: ActorContextTab; label: string }[]
	tab: ActorContextTab
	onTab: (t: ActorContextTab) => void
} = $props()
</script>

<aside class="flex min-h-0 w-max max-w-none shrink-0 flex-col">
	<div class="flex w-full shrink-0 items-center justify-end gap-2 mb-1.5">
		<span class="text-[9px] font-bold uppercase tracking-[0.26em] opacity-30">Views</span>
	</div>
	<nav
		class="scrollbar-gutter-stable flex max-h-full min-h-0 w-max flex-col items-end gap-0.5 overflow-y-auto"
		aria-label="Skill views"
	>
		{#each tabs as item (item.id)}
			<button
				type="button"
				class="rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-tight transition-colors whitespace-nowrap w-fit max-w-none {tab === item.id
					? 'bg-foreground text-background'
					: 'opacity-45 hover:opacity-90 hover:bg-foreground/5'}"
				onclick={() => onTab(item.id)}
			>
				{item.label}
			</button>
		{/each}
	</nav>
</aside>
