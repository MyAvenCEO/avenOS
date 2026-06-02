<script lang="ts">
import { BOARD_COLUMN_META } from './columns'
import { renderWorkItemMarkdown } from './render'
import type { WorkItem } from './types'

type Props = {
	item: WorkItem
	backHref?: string
	backLabel?: string
	onBack?: (e: MouseEvent) => void
}

let { item, backHref = '/board', backLabel = 'Back to board', onBack }: Props = $props()

const rendered = $derived(renderWorkItemMarkdown(item.body))
const columnMeta = $derived(BOARD_COLUMN_META[item.column])
</script>

<div
	class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-sans text-foreground antialiased"
>
	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="mx-auto w-full max-w-[min(100%,90rem)] px-4 pt-6 pb-28 sm:px-8 md:px-12">
			<header class="mb-8 border-b border-border/50 pb-6">
				<div
					class="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold tracking-widest uppercase"
				>
					<span class="rounded-full bg-white/10 px-2.5 py-1 text-foreground/70">
						{columnMeta.label}
					</span>
					<span class="text-muted-foreground opacity-50">{item.id}</span>
					{#each item.tags as tag (tag)}
						<span class="rounded-full border border-border/60 px-2.5 py-1 text-muted-foreground">
							{tag}
						</span>
					{/each}
				</div>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h1>
				{#if item.summary}
					<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
						{item.summary}
					</p>
				{/if}
				{#if item.owner || item.created || item.updated}
					<div
						class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
					>
						{#if item.owner}
							<span>Owner: <span class="text-foreground/80">@{item.owner}</span></span>
						{/if}
						{#if item.created}
							<span>Created: {item.created}</span>
						{/if}
						{#if item.updated}
							<span>Updated: {item.updated}</span>
						{/if}
					</div>
				{/if}
			</header>

			<article
				class="doc-markdown min-w-0 select-text [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border/50 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:mb-5 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:scroll-mt-24 [&_h3]:text-base [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_p]:leading-relaxed [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/50 [&_pre]:bg-muted/40 [&_pre]:p-4 [&_pre]:text-[13px] [&_strong]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2 [&_td]:text-sm [&_th]:border [&_th]:border-border/50 [&_th]:bg-muted/30 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:opacity-80 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
			>
				<!-- {@html} is sanitized by renderWorkItemMarkdown (DOMPurify). -->
				{@html rendered.html}
			</article>
		</div>
	</div>

	<div
		class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]"
	>
		<a
			href={backHref}
			data-sveltekit-preload-data="hover"
			class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-5 py-2.5 text-xs font-bold tracking-widest uppercase text-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-white/10"
			onclick={(e) => onBack?.(e)}
		>
			<svg class="size-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
				<path
					d="M15 18l-6-6 6-6"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
			{backLabel}
		</a>
	</div>
</div>
