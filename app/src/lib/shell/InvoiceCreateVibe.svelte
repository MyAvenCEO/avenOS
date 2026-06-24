<script lang="ts">
import {
	createDocCompareShell,
	type InvoiceDoc,
	invoiceDocToDoctype,
	mapInvoiceToView
} from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { INVOICE_DOC_SCHEMA } from '@avenos/aven-vibes/invoice-doc'
import { createQuery } from '@tanstack/svelte-query'
import { saveInvoicePdf } from '$lib/avendb/invoice-pdf'
import { type DataValue, ensureSchema, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// board 0082 — the outgoing-invoice authoring view. When the create/update/state tools emit a doc it
// renders that invoice (number + state + version + positions + VAT) with a "save PDF" affordance;
// otherwise it lists all outgoing invoices (latest version per number) from /api/data.
let {
	containerName = 'aven-vibes-invoice-create',
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

const STATE_LABEL: Record<string, string> = {
	entwurf: 'Entwurf',
	angebot: 'Angebot',
	rechnung: 'Rechnung'
}
const STATE_CLS: Record<string, string> = {
	entwurf: 'bg-slate-700/90 text-slate-50',
	angebot: 'bg-amber-900/90 text-amber-50',
	rechnung: 'bg-green-900/90 text-green-50'
}

const doc = $derived((data as unknown as InvoiceDoc | undefined) ?? null)
const shell = createDocCompareShell('invoice', {})
// Render through the SAME generic invoice template as an extracted invoice (Beleg + Parteien +
// Positionen + Summen) by converting our doc to the ingested-invoice shape. board 0082.
const docView = $derived(
	doc ? (mapInvoiceToView(invoiceDocToDoctype(doc)) as unknown as Record<string, unknown>) : null
)

let schemaId = $state<string | null>(null)
let started = false
$effect(() => {
	if (started || doc) return
	started = true
	void (async () => {
		try {
			schemaId = await ensureSchema(
				'invoice_doc',
				INVOICE_DOC_SCHEMA as unknown as Record<string, unknown>
			)
		} catch {
			/* ignore */
		}
	})()
})
const listQuery = createQuery(() => ({
	queryKey: schemaId ? qk.values(schemaId) : ['data', 'values', 'invoice-doc-pending'],
	queryFn: () => listValues<InvoiceDoc>(schemaId as string),
	enabled: !!schemaId && !doc
}))
// Latest version per number.
const latest = $derived.by(() => {
	const byNumber = new Map<string, DataValue<InvoiceDoc>>()
	for (const r of listQuery.data ?? []) {
		const n = r.data.number
		const cur = byNumber.get(n)
		if (!cur || (r.data.version ?? 0) > (cur.data.version ?? 0)) byNumber.set(n, r)
	}
	return [...byNumber.values()]
})

function money(n: number | null | undefined): string {
	if (typeof n !== 'number') return '—'
	return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Render → store the PDF in the PRIVATE store → stamp pdf_file_hash on the latest version row.
let saving = $state(false)
let savedHash = $state<string | null>(null)
async function savePdf(): Promise<void> {
	if (!doc || saving) return
	saving = true
	try {
		const id = await ensureSchema(
			'invoice_doc',
			INVOICE_DOC_SCHEMA as unknown as Record<string, unknown>
		)
		const rows = await listValues<InvoiceDoc>(id)
		const row = rows
			.filter((r) => r.data.number === doc.number)
			.sort((a, b) => (b.data.version ?? 0) - (a.data.version ?? 0))[0]
		if (row) savedHash = await saveInvoicePdf(doc, row.id)
	} catch (e) {
		console.error('[invoice-pdf] save failed:', e)
	} finally {
		saving = false
	}
}
</script>

{#if doc && docView}
	<!-- Single invoice detail (emitted by create/update/state). board 0082. -->
	<div
		class="border-border bg-card mx-auto flex w-full max-w-2xl flex-col gap-2 rounded-[var(--radius-lg)] border p-3"
		data-container={containerName}
	>
		<div class="flex items-center justify-between gap-2">
			<span class="text-foreground font-semibold">{doc.number}</span>
			<span class="flex items-center gap-1">
				<span
					class="rounded-full px-2 py-0.5 text-[10px] font-semibold {STATE_CLS[doc.state] ?? ''}"
					>{STATE_LABEL[doc.state] ?? doc.state}</span
				>
				<span class="text-muted-foreground text-[10px]">v{doc.version ?? 1}</span>
			</span>
		</div>
		<AvenVibeView
			{shell}
			source={docView}
			onEvent={() => {}}
			containerName={`${containerName}-doc`}
			desktopHint="Loading…"
		/>
		<div class="flex items-center justify-between gap-2">
			<p class="text-muted-foreground text-[10px]">
				{savedHash || doc.pdf_file_hash
					? t('mainnet.invoiceCreate.pdfSaved')
					: t('mainnet.invoiceCreate.pdfHint')}
			</p>
			<button
				type="button"
				class="border-border hover:bg-card rounded-[var(--radius)] border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
				onclick={savePdf}
				disabled={saving}
			>
				{saving ? '…' : t('mainnet.invoiceCreate.savePdf')}
			</button>
		</div>
	</div>
{:else}
	<!-- All outgoing invoices. -->
	<div
		class="mx-auto flex min-h-[200px] w-full max-w-2xl flex-col gap-3"
		data-container={containerName}
	>
		<h2 class="text-foreground text-lg font-semibold tracking-tight">
			{t('mainnet.invoiceCreate.title')}
		</h2>
		{#if latest.length === 0}
			<p class="text-muted-foreground py-8 text-center text-sm">
				{t('mainnet.invoiceCreate.empty')}
			</p>
		{:else}
			<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
				<table class="w-full border-collapse text-xs">
					<thead>
						<tr class="text-muted-foreground border-border border-b text-left">
							<th class="px-3 py-2 font-semibold">{t('mainnet.invoiceCreate.number')}</th>
							<th class="px-3 py-2 font-semibold">{t('mainnet.invoiceCreate.state')}</th>
							<th class="px-3 py-2 text-right font-semibold">{t('mainnet.invoiceCreate.gross')}</th>
						</tr>
					</thead>
					<tbody>
						{#each latest as r (r.id)}
							<tr class="border-border/60 border-b last:border-0">
								<td class="text-foreground px-3 py-2 font-medium">{r.data.number}</td>
								<td class="px-3 py-2">
									<span
										class="rounded-full px-2 py-0.5 text-[10px] font-semibold {STATE_CLS[
											r.data.state
										] ?? ''}"
										>{STATE_LABEL[r.data.state] ?? r.data.state}</span
									>
									<span class="text-muted-foreground text-[10px]">v{r.data.version ?? 1}</span>
								</td>
								<td class="text-foreground px-3 py-2 text-right tabular-nums">
									{money(r.data.totals?.gross_total)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
{/if}
