<script lang="ts">
import type { WorkItem } from './types'

type Props = {
	item: WorkItem
	href: string
	/** Optional in-app navigation handler (e.g. SvelteKit goto). Falls back to plain link. */
	onOpen?: (item: WorkItem, e: MouseEvent) => void
}

let { item, href, onOpen }: Props = $props()
</script>

<a
	{href}
	data-sveltekit-preload-data="hover"
	class="tech-card group flex flex-col gap-2 p-3.5 no-underline"
	onclick={(e) => onOpen?.(item, e)}
>
	<p class="text-sm font-semibold leading-snug tracking-tight text-foreground">
		{item.title}
	</p>
	{#if item.summary}
		<p class="line-clamp-3 text-xs leading-snug text-muted-foreground">
			{item.summary}
		</p>
	{/if}
	{#if item.tags.length > 0 || item.owner}
		<div class="mt-0.5 flex flex-wrap items-center gap-1.5">
			{#if item.owner}
				<span
					class="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
				>
					@{item.owner}
				</span>
			{/if}
			{#each item.tags as tag (tag)}
				<span
					class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground"
				>
					{tag}
				</span>
			{/each}
		</div>
	{/if}
	<span
		class="mt-0.5 flex items-center gap-1 text-[9px] font-bold tracking-widest text-muted-foreground uppercase opacity-0 transition-opacity group-hover:opacity-60"
	>
		{item.id}
	</span>
</a>
