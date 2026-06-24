<script lang="ts">
import type { BookingRecord, InvoiceMatch } from '@avenos/aven-vibes'

// board 0070 — ONE merged reconciliation card: invoice excerpt → matched bank transaction → the
// SKR04 Buchungssatz, compact. Data = { invoice, match, booking, currency }.
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
const booking = $derived((data?.booking ?? null) as BookingRecord | null)
const booked = $derived(booking?.status === 'booked')
const bcur = $derived(booking?.currency ?? currency)
// Confidence in the picked account: high / medium / low. board 0080.
const conf = $derived(
	{
		high: { label: 'Sicher', cls: 'bg-green-900/90 text-green-50' },
		medium: { label: 'Mittel', cls: 'bg-amber-900/90 text-amber-50' },
		low: { label: 'Unsicher', cls: 'bg-red-900/90 text-red-50' }
	}[(booking?.confidence ?? 'medium') as 'high' | 'medium' | 'low'] ?? null
)
// Soll positions — fall back to a single synthesized line for bookings stored before splits (0073).
const lines = $derived(
	booking?.lines?.length
		? booking.lines
		: booking
			? [
					{
						soll_konto: booking.soll_konto,
						soll_bezeichnung: booking.soll_bezeichnung,
						gross_amount: booking.gross_amount,
						tax_key: booking.tax_key
					}
				]
			: []
)
</script>

<div
	class="border-border bg-card mx-auto flex w-full max-w-2xl flex-col rounded-[var(--radius-lg)] border text-sm"
>
	<!-- Reconciliation: invoice summary (left) ↔ matched transaction (right). board 0072. -->
	<div class="grid grid-cols-2 divide-x divide-[var(--border)]">
		<!-- Left: invoice summary -->
		<div class="flex flex-col gap-0.5 p-3">
			<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
				Rechnung
			</p>
			<p class="text-foreground truncate font-semibold" title={vendor}>{vendor}</p>
			<p class="text-muted-foreground text-xs">Nr. {number} · {date}</p>
			<p class="text-foreground mt-0.5 font-semibold tabular-nums">{money(total, currency)}</p>
		</div>
		<!-- Right: matched transaction -->
		<div class="flex flex-col gap-0.5 p-3">
			<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">Zahlung</p>
			{#if tx}
				<p
					class="text-foreground truncate font-medium"
					title={tx.counterparty_name ?? tx.counterparty_iban ?? tx.description ?? ''}
				>
					{tx.counterparty_name ?? tx.counterparty_iban ?? tx.description ?? 'Buchung'}
				</p>
				<p class="text-muted-foreground text-xs">
					{tx.booking_date ?? tx.value_date ?? '—'}
					·
					<span class={match?.confidence === 'high' ? 'text-green-600' : 'text-amber-600'}>
						{match?.confidence === 'high' ? 'Sicher' : 'Wahrscheinlich'}
					</span>
				</p>
				<p
					class="mt-0.5 font-semibold tabular-nums {typeof tx.amount === 'number' && tx.amount < 0 ? 'text-destructive' : 'text-foreground'}"
				>
					{money(tx.amount, tx.currency ?? currency)}
				</p>
			{:else}
				<p class="text-muted-foreground text-xs">Keine passende Buchung gefunden.</p>
			{/if}
		</div>
	</div>

	<!-- SKR04 Buchungssatz (one row per Soll position — a Splitbuchung shows several). board 0073. -->
	<div class="border-border/60 bg-muted/30 rounded-b-[var(--radius-lg)] border-t px-3 py-2">
		<div
			class="text-muted-foreground mb-1 flex items-center justify-between text-[10px] font-semibold tracking-wide uppercase"
		>
			<span>{booking?.is_split ? `Splitbuchung · ${lines.length} Pos.` : 'Buchung'}</span>
			<span class="flex items-center gap-1">
				{#if booked && conf}
					<span class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold normal-case {conf.cls}"
						>{conf.label}</span
					>
				{/if}
				<span>SKR04</span>
			</span>
		</div>
		{#if booked && booking}
			<div class="flex flex-col gap-1 text-xs">
				{#each lines as l, i (i)}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground shrink-0">{i === 0 ? 'Soll' : ''}</span>
						<span class="text-foreground min-w-0 flex-1 truncate text-right font-medium">
							{l.soll_konto}
							· {l.soll_bezeichnung ?? ''}
							{#if l.tax_key}
								<span class="text-muted-foreground font-normal">· {l.tax_key}</span>
							{/if}
						</span>
						{#if booking.is_split}
							<span class="text-foreground shrink-0 tabular-nums"
								>{money(l.gross_amount, bcur)}</span
							>
						{/if}
					</div>
				{/each}
				<div class="flex justify-between gap-2">
					<span class="text-muted-foreground">Haben</span>
					<span class="text-foreground min-w-0 truncate text-right"
						>{booking.haben_konto ?? '—'}
						· {booking.haben_bezeichnung ?? ''}</span
					>
				</div>
				{#if !booking.is_split}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">Steuer</span>
						<span class="text-foreground text-right">{booking.tax_key ?? '—'}</span>
					</div>
				{/if}
				<div class="border-border/60 mt-0.5 flex justify-between gap-2 border-t pt-1">
					<span class="text-muted-foreground">Brutto</span>
					<span class="text-foreground text-right font-semibold tabular-nums"
						>{money(booking.gross_amount, bcur)}</span
					>
				</div>
				{#if booking.buchungstext}
					<p class="text-muted-foreground truncate">{booking.buchungstext}</p>
				{/if}
			</div>
		{:else}
			<p class="text-muted-foreground text-xs">
				{booking?.reason || 'Kein passendes Konto gefunden.'}
			</p>
		{/if}
	</div>
</div>
