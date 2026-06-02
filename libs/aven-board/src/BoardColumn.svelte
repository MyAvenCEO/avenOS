<script lang="ts">
import BoardCard from './BoardCard.svelte'
import type { BoardColumn, WorkItem } from './types'
import { boardItemHref } from './work-items'

type Props = {
	column: BoardColumn
	base?: string
	emptyLabel?: string
	onOpen?: (item: WorkItem, e: MouseEvent) => void
}

let { column, base = '/board', emptyLabel = 'Nothing here yet.', onOpen }: Props = $props()
</script>

<section class="flex min-h-0 w-80 shrink-0 flex-col">
	<header class="mb-2 flex items-baseline justify-between gap-2 px-0.5">
		<div class="flex items-baseline gap-2">
			<h2 class="text-sm font-semibold tracking-tight text-foreground">{column.label}</h2>
			<span
				class="text-[10px] font-bold tracking-widest text-muted-foreground uppercase opacity-50"
			>
				{column.aka}
			</span>
		</div>
		<span
			class="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
		>
			{column.items.length}
		</span>
	</header>
	<p class="mb-3 px-0.5 text-[11px] leading-snug text-muted-foreground opacity-70">
		{column.description}
	</p>
	<div
		class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-2xl border border-dashed border-border bg-black/[0.015] p-3 dark:bg-white/[0.02]"
	>
		{#if column.items.length === 0}
			<p class="px-2 py-6 text-center text-xs text-muted-foreground opacity-60">
				{emptyLabel}
			</p>
		{:else}
			{#each column.items as item (item.id)}
				<BoardCard {item} href={boardItemHref(item, base)} {onOpen} />
			{/each}
		{/if}
	</div>
</section>
