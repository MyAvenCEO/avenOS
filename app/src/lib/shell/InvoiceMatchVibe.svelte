<script lang="ts">
import type { InvoiceMatch } from '@avenos/aven-vibes'

// board 0070 — compact reconciliation summary: a short invoice excerpt matched to the paying
// transaction (or "keine"). Replaces the full side-by-side doc-views.
let {
	data
}: {
	containerName?: string
	data?: Record<string, unknown>
} = $props()

function rec(v: unknown): Record<string, unknown> {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function str(v: unknown): string {
	return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}
function money(n: unknown, cur?: string): string {
	if (typeof n !== 'number') return '—'
	return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ''}`
}

const invoice = $derived(rec(data?.invoice))
const hdr = $derived(rec(invoice.header))
const totals = $derived(rec(invoice.totals))
const currency = $derived(str(data?.currency) || str(hdr.currency))
const vendor = $derived(str(rec(invoice.vendor).name) || '—')
const number = $derived(str(hdr.invoice_number) || '—')
const date = $derived(str(hdr.issue_date) || '—')
const total = $derived(
	typeof totals.invoice_total === 'number'
		? (totals.invoice_total as number)
		: typeof invoice.total_outstanding === 'number'
			? (invoice.total_outstanding as number)
			: null
)

const match = $derived((data?.match ?? null) as InvoiceMatch | null)
const tx = $derived(match?.tx ?? null)
const matched = $derived(!!tx)
const conf = $derived(
	match?.confidence === 'high'
		? { label: 'Sicher', cls: 'bg-green-600/15 text-green-700' }
		: match?.confidence === 'medium'
			? { label: 'Wahrscheinlich', cls: 'bg-amber-500/15 text-amber-700' }
			: { label: 'Unsicher', cls: 'bg-red-600/15 text-red-700' }
)
</script>

<div
	class="border-border bg-card mx-auto w-full max-w-2xl rounded-[var(--radius-lg)] border text-sm"
>
	<!-- Reconciliation 50/50: the invoice (left) ↔ the matched bank transaction (right). -->
	<div class="grid grid-cols-2 divide-x divide-[var(--border)]">
		<!-- Left: invoice -->
		<div class="flex flex-col gap-1 p-3">
			<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
				Rechnung
			</p>
			<p class="text-foreground truncate font-semibold">{vendor}</p>
			<p class="text-muted-foreground text-xs">Nr. {number} · {date}</p>
			<p class="text-foreground mt-auto pt-2 text-base font-semibold tabular-nums">
				{money(total, currency)}
			</p>
		</div>
		<!-- Right: matched transaction -->
		<div class="flex flex-col gap-1 p-3">
			<div class="flex items-center justify-between gap-2">
				<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
					Zahlung
				</p>
				{#if matched}
					<span class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold {conf.cls}"
						>{conf.label}</span
					>
				{/if}
			</div>
			{#if matched && tx}
				<p class="text-foreground truncate font-semibold">
					{tx.counterparty_name ?? tx.counterparty_iban ?? tx.description ?? 'Buchung'}
				</p>
				<p class="text-muted-foreground text-xs">{tx.booking_date ?? tx.value_date ?? '—'}</p>
				<p
					class="mt-auto pt-2 text-base font-semibold tabular-nums {typeof tx.amount === 'number' && tx.amount < 0 ? 'text-destructive' : 'text-foreground'}"
				>
					{money(tx.amount, tx.currency ?? currency)}
				</p>
			{:else}
				<p class="text-muted-foreground mt-auto pt-2 text-xs">
					Keine passende Buchung im Kontoauszug gefunden.
				</p>
			{/if}
		</div>
	</div>

	{#if matched && match?.reasons?.length}
		<div class="border-border/60 border-t px-3 py-2">
			<div class="flex flex-wrap gap-1">
				{#each match.reasons as r (r)}
					<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px]">{r}</span>
				{/each}
			</div>
		</div>
	{/if}
</div>
