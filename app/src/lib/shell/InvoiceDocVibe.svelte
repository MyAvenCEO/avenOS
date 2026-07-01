<script lang="ts">
import { createDocCompareShell, type DocType, isDocType, mapDocView } from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'

// board 0096/0097 — the EXTRACTED INVOICE alone: a HERO header (big invoice-nr top-left, big
// accent-coloured total top-right, key metadata below — layout reused from the legacy OCR project's
// inv-banner-hero) on top of the generic doc-view body (parties · positions · summen). No side-by-side
// original-doc preview (that's DocCompareVibe). Used by the extract step's vibe card.
let {
	containerName = 'aven-vibes-invoice-doc',
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

const type = $derived<DocType>(isDocType(data?.type) ? (data?.type as DocType) : 'invoice')
const extracted = $derived((data?.extracted ?? {}) as Record<string, unknown>)
const shell = createDocCompareShell('invoice', {})

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const str = (v: unknown): string => (v == null ? '' : String(v))
const header = $derived(rec(extracted.header))
const totals = $derived(rec(extracted.totals))
const currency = $derived(str(header.currency))

// Hero fields — tolerate both the rich extraction (header/totals) and the flattened enrich output.
const kindLabel = $derived(str(header.document_kind) || 'Rechnung')
const invoiceNr = $derived(str(header.invoice_number) || str(extracted.number) || '—')
const totalRaw = $derived(totals.invoice_total ?? extracted.total)
function money(v: unknown): string {
	if (v == null || v === '') return ''
	const n = Number(v)
	const formatted = Number.isFinite(n)
		? new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
		: str(v)
	return currency ? `${formatted} ${currency}` : formatted
}
const totalLabel = $derived(money(totalRaw))
const metaFields = $derived(
	(
		[
			['Ausstellung', str(header.issue_date)],
			['Fällig', str(header.due_date)],
			['Auftrag / Projekt', str(header.order_number)],
			['Kundennr.', str(header.customer_number)],
			['Währung', currency]
		] as [string, string][]
	).filter(([, v]) => v)
)

// The doc-view body WITHOUT the "Beleg" section — the hero now carries that metadata (no duplication).
const view = $derived.by(() => {
	const full = mapDocView(type, extracted) as unknown as { sections?: { title?: string }[] } & Record<string, unknown>
	return { ...full, sections: (full.sections ?? []).filter((s) => s.title !== 'Beleg') } as unknown as Record<
		string,
		unknown
	>
})
</script>

<div class="border-border mx-auto max-h-[80vh] w-full overflow-y-auto rounded-[var(--radius-lg)] border p-3">
	<!-- HERO: invoice nr (left) · total (right, accent) · metadata row -->
	<div
		class="border-border from-primary/[0.04] mb-3 rounded-[var(--radius-lg)] border bg-gradient-to-br to-transparent p-4"
	>
		<div class="flex flex-wrap items-end justify-between gap-3">
			<div class="min-w-0">
				<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">{kindLabel}</p>
				<p class="text-foreground truncate text-2xl font-extrabold tracking-tight">{invoiceNr}</p>
			</div>
			{#if totalLabel}
				<div class="text-right">
					<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
						Rechnungsbetrag
					</p>
					<p class="text-primary font-mono text-2xl font-extrabold tabular-nums">{totalLabel}</p>
				</div>
			{/if}
		</div>
		{#if metaFields.length > 0}
			<div class="border-border/60 mt-3 flex flex-wrap gap-x-8 gap-y-2 border-t pt-3">
				{#each metaFields as [label, value] (label)}
					<div>
						<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
							{label}
						</p>
						<p class="text-foreground text-[13px] font-medium">{value}</p>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<AvenVibeView {shell} source={view} onEvent={() => {}} {containerName} desktopHint="Loading…" />
</div>
