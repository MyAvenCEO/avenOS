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
</script>

<div
	class="border-border bg-card mx-auto flex w-full max-w-2xl flex-col gap-2 rounded-[var(--radius-lg)] border p-3 text-sm"
>
	<div class="flex items-center justify-between gap-2">
		<div class="min-w-0">
			<p class="text-foreground truncate font-semibold">{vendor}</p>
			<p class="text-muted-foreground text-xs">Rechnung {number} · {date}</p>
		</div>
		<span class="text-foreground shrink-0 font-semibold tabular-nums"
			>{money(total, currency)}</span
		>
	</div>

	<div class="border-border/60 border-t pt-2">
		{#if matched && tx}
			<div class="flex items-center justify-between gap-2">
				<div class="min-w-0">
					<p class="text-foreground truncate text-xs">
						↳ {tx.counterparty_name ?? tx.counterparty_iban ?? tx.description ?? 'Buchung'}
					</p>
					<p class="text-muted-foreground text-[11px]">
						{tx.booking_date ?? tx.value_date ?? '—'}
						·
						<span class="{match?.confidence === 'high' ? 'text-green-600' : 'text-amber-600'}">
							{match?.confidence === 'high' ? 'Sicher' : 'Wahrscheinlich'}
						</span>
					</p>
				</div>
				<span
					class="shrink-0 font-medium tabular-nums {typeof tx.amount === 'number' && tx.amount < 0 ? 'text-destructive' : 'text-foreground'}"
				>
					{money(tx.amount, tx.currency ?? currency)}
				</span>
			</div>
		{:else}
			<p class="text-muted-foreground text-xs">↳ Keine passende Buchung im Kontoauszug gefunden.</p>
		{/if}
	</div>
</div>
