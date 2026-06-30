<script lang="ts">
// board 0070 — compact, standalone classification card: a small doc thumbnail + the document type
// + title/tags. Ephemeral; data comes from the classify_document tool. (Replaced the big 60/40
// preview layout — classification is now just a small card with the doc attached.)
let {
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

const TYPE_LABELS: Record<string, string> = {
	invoice: 'Rechnung',
	bank_statement: 'Kontoauszug',
	contract: 'Vertrag',
	other: 'Sonstiges'
}

// board 0096/0097: classify provides `kind` (now a doctype REF like `doctype-invoice` — strip the
// prefix for the label) + `summary`; keep `docType`/`description` back-compat.
const docType = $derived(
	(typeof data?.kind === 'string'
		? (data?.kind as string)
		: typeof data?.docType === 'string'
			? (data?.docType as string)
			: 'other'
	).replace(/^doctype-/, '')
)
const typeLabel = $derived(TYPE_LABELS[docType] ?? TYPE_LABELS.other)
const title = $derived(typeof data?.title === 'string' ? (data?.title as string) : '')
const description = $derived(
	typeof data?.summary === 'string'
		? (data?.summary as string)
		: typeof data?.description === 'string'
			? (data?.description as string)
			: ''
)
const bookingSummary = $derived(
	typeof data?.booking_summary === 'string' ? (data?.booking_summary as string) : ''
)
const tags = $derived(Array.isArray(data?.tags) ? (data?.tags as string[]) : [])
const fileUrl = $derived(typeof data?.fileUrl === 'string' ? (data?.fileUrl as string) : '')

const chip = $derived(
	{
		invoice: 'bg-blue-900/90 text-blue-50',
		bank_statement: 'bg-green-900/90 text-green-50',
		contract: 'bg-amber-900/90 text-amber-50',
		other: 'bg-slate-700/90 text-slate-50'
	}[docType] ?? 'bg-slate-700/90 text-slate-50'
)
</script>

<div
	class="border-border bg-card mx-auto flex w-full max-w-md items-start gap-3 rounded-[var(--radius-lg)] border p-3"
>
	<div
		class="border-border bg-background flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border"
	>
		{#if fileUrl}
			<img src={fileUrl} alt="" class="h-full w-full object-cover">
		{:else}
			<span class="text-muted-foreground text-[9px]">PDF</span>
		{/if}
	</div>
	<div class="flex min-w-0 flex-1 flex-col gap-1">
		<span
			class="self-start rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide {chip}"
		>
			{typeLabel}
		</span>
		<p class="text-foreground truncate text-sm font-semibold" {title}>{title || '—'}</p>
		{#if bookingSummary}
			<p class="text-foreground/80 text-xs font-medium whitespace-pre-line" title={bookingSummary}>
				{bookingSummary}
			</p>
		{/if}
		{#if description}
			<p class="text-muted-foreground line-clamp-2 text-xs">{description}</p>
		{/if}
		{#if tags.length}
			<div class="mt-0.5 flex flex-wrap gap-1">
				{#each tags.slice(0, 6) as tag (tag)}
					<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
						>{tag}</span
					>
				{/each}
			</div>
		{/if}
	</div>
</div>
