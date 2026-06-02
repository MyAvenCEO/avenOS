<script lang="ts">
import BoardColumn from './BoardColumn.svelte'
import type { BoardColumn as BoardColumnType, WorkItem } from './types'

type Props = {
	columns: BoardColumnType[]
	base?: string
	title?: string
	subtitle?: string
	emptyLabel?: string
	onOpen?: (item: WorkItem, e: MouseEvent) => void
}

let {
	columns,
	base = '/board',
	title = 'Board',
	subtitle = 'Git-based work items flowing inbox → plan → test → done.',
	emptyLabel = 'Nothing here yet.',
	onOpen
}: Props = $props()

const total = $derived(columns.reduce((sum, c) => sum + c.items.length, 0))
</script>

<div
	class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-sans text-foreground antialiased"
>
	<header class="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
		<div class="mx-auto w-full max-w-[min(100%,88rem)]">
			<p class="tech-label mb-2">Kanban</p>
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
				<span class="text-sm font-medium text-muted-foreground tabular-nums">
					{total}
					{total === 1 ? 'item' : 'items'}
				</span>
			</div>
			<p class="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
				{subtitle}
			</p>
		</div>
	</header>

	<div class="min-h-0 flex-1 overflow-y-auto overflow-x-auto px-4 pb-8 sm:px-6">
		<div
			class="mx-auto flex w-full max-w-[min(100%,88rem)] gap-4 sm:gap-5"
		>
			{#each columns as column (column.id)}
				<BoardColumn {column} {base} {emptyLabel} {onOpen} />
			{/each}
		</div>
	</div>
</div>
