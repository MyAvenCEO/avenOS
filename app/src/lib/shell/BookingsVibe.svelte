<script lang="ts">
import {
	type BookingRecord,
	createDocCompareShell,
	mapBookingToView,
	mapDocView
} from '@avenos/aven-vibes'
import AvenVibeView from '@avenos/aven-vibes/AvenVibeView.svelte'
import { BOOKING_SCHEMA } from '@avenos/aven-vibes/booking'
import { createQuery } from '@tanstack/svelte-query'
import { type DataValue, ensureSchema, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// board 0071/0077 — live "all bookings" view. List of Buchungssätze (data-backed from the `booking`
// schema), and a 50/50 "prüf" detail: pick a booking → its Buchungssatz (split-aware) on the LEFT,
// the referenced source invoice (looked up by invoice_value_id) on the RIGHT, to double-check it.
let { containerName = 'aven-vibes-booking' }: { containerName?: string } = $props()

type Booking = {
	invoice_value_id?: string | null
	invoice_number?: string | null
	vendor?: string | null
	currency?: string | null
	soll_konto?: string | null
	soll_bezeichnung?: string | null
	haben_konto?: string | null
	tax_key?: string | null
	gross_amount?: number | null
	status?: string | null
	buchungstext?: string | null
	is_split?: boolean | null
	lines?: { soll_konto?: string | null }[] | null
	confidence?: string | null
}

const CONF: Record<string, { label: string; cls: string }> = {
	high: { label: 'Sicher', cls: 'bg-green-900/90 text-green-50' },
	medium: { label: 'Mittel', cls: 'bg-amber-900/90 text-amber-50' },
	low: { label: 'Unsicher', cls: 'bg-red-900/90 text-red-50' }
}

let schemaId = $state<string | null>(null)
let invoiceSchemaId = $state<string | null>(null)
let err = $state<string | null>(null)
let selectedId = $state<string | null>(null)
let started = false

$effect(() => {
	if (started) return
	started = true
	void (async () => {
		try {
			schemaId = await ensureSchema('booking', BOOKING_SCHEMA as unknown as Record<string, unknown>)
			// The invoice schema already exists (created during extraction); just find its id.
			invoiceSchemaId = (await listSchemas()).find((s) => s.name === 'invoice')?.id ?? null
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	})()
})

const valuesQuery = createQuery(() => ({
	queryKey: schemaId ? qk.values(schemaId) : ['data', 'values', 'booking-pending'],
	queryFn: () => listValues<Booking>(schemaId as string),
	enabled: !!schemaId
}))
const invoicesQuery = createQuery(() => ({
	queryKey: invoiceSchemaId ? qk.values(invoiceSchemaId) : ['data', 'values', 'invoice-pending'],
	queryFn: () => listValues<Record<string, unknown>>(invoiceSchemaId as string),
	enabled: !!invoiceSchemaId
}))

const rows = $derived<DataValue<Booking>[]>(valuesQuery.data ?? [])
const currency = $derived(rows.find((r) => r.data.currency)?.data.currency ?? '')
const total = $derived(
	rows.reduce((s, r) => s + (typeof r.data.gross_amount === 'number' ? r.data.gross_amount : 0), 0)
)
const invoiceById = $derived(new Map((invoicesQuery.data ?? []).map((v) => [v.id, v.data])))

const selected = $derived(rows.find((r) => r.id === selectedId) ?? null)
const shell = createDocCompareShell('invoice', {})
const bookingView = $derived(
	selected
		? (mapBookingToView(selected.data as unknown as BookingRecord) as unknown as Record<
				string,
				unknown
			>)
		: null
)
const refInvoice = $derived(
	selected?.data.invoice_value_id ? invoiceById.get(selected.data.invoice_value_id) : undefined
)
const invoiceView = $derived(
	refInvoice ? (mapDocView('invoice', refInvoice) as unknown as Record<string, unknown>) : null
)

function money(n: number | null | undefined): string {
	if (typeof n !== 'number') return '—'
	return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

{#if selected}
	<!-- 50/50 prüf detail: booking (left) ↔ referenced invoice (right). board 0077. -->
	<div class="flex w-full flex-col gap-3" data-container={containerName}>
		<div class="flex items-center justify-between gap-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs font-medium"
				onclick={() => (selectedId = null)}
			>
				← {t('mainnet.bookings.back')}
			</button>
			<span class="text-foreground truncate text-sm font-semibold">
				{selected.data.vendor ?? '—'}
				{#if selected.data.invoice_number}
					<span class="text-muted-foreground font-normal">· {selected.data.invoice_number}</span>
				{/if}
			</span>
		</div>
		<div class="grid min-h-[320px] w-full grid-cols-1 gap-3 md:grid-cols-2">
			<!-- Left: the Buchungssatz (split-aware) -->
			<div class="border-border max-h-[80vh] overflow-y-auto rounded-[var(--radius-lg)] border p-3">
				{#if bookingView}
					<AvenVibeView
						{shell}
						source={bookingView}
						onEvent={() => {}}
						containerName={`${containerName}-bk`}
						desktopHint="Loading…"
					/>
				{/if}
			</div>
			<!-- Right: the referenced source invoice (to prüf the booking against) -->
			<div class="border-border max-h-[80vh] overflow-y-auto rounded-[var(--radius-lg)] border p-3">
				{#if invoiceView}
					<AvenVibeView
						{shell}
						source={invoiceView}
						onEvent={() => {}}
						containerName={`${containerName}-inv`}
						desktopHint="Loading…"
					/>
				{:else}
					<p class="text-muted-foreground p-6 text-center text-sm">
						{t('mainnet.bookings.noInvoice')}
					</p>
				{/if}
			</div>
		</div>
	</div>
{:else}
	<div
		class="mx-auto flex min-h-[200px] w-full max-w-2xl flex-col gap-3"
		data-container={containerName}
	>
		{#if err}
			<p class="text-destructive text-sm" role="alert">{err}</p>
		{/if}

		<div class="flex items-baseline justify-between">
			<h2 class="text-foreground text-lg font-semibold tracking-tight">
				{t('mainnet.bookings.title')}
			</h2>
			<span class="text-muted-foreground text-xs tabular-nums">
				{rows.length}
				{t('mainnet.bookings.count')}
				· {money(total)}
				{currency}
			</span>
		</div>

		{#if rows.length === 0}
			<p class="text-muted-foreground py-8 text-center text-sm">{t('mainnet.bookings.empty')}</p>
		{:else}
			<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
				<table class="w-full border-collapse text-xs">
					<thead>
						<tr class="text-muted-foreground border-border border-b text-left">
							<th class="px-3 py-2 font-semibold">{t('mainnet.bookings.vendor')}</th>
							<th class="px-3 py-2 font-semibold">{t('mainnet.bookings.soll')}</th>
							<th class="px-3 py-2 font-semibold">{t('mainnet.bookings.haben')}</th>
							<th class="px-3 py-2 font-semibold">{t('mainnet.bookings.tax')}</th>
							<th class="px-3 py-2 text-right font-semibold">{t('mainnet.bookings.gross')}</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as r (r.id)}
							<tr
								class="border-border/60 hover:bg-muted/40 cursor-pointer border-b last:border-0"
								onclick={() => (selectedId = r.id)}
							>
								<td class="text-foreground px-3 py-2">
									<div class="flex items-center gap-1.5">
										<span class="truncate font-medium">{r.data.vendor ?? '—'}</span>
										{#if r.data.confidence && CONF[r.data.confidence]}
											<span
												class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold {CONF[
													r.data.confidence
												].cls}"
												>{CONF[r.data.confidence].label}</span
											>
										{/if}
									</div>
									<div class="text-muted-foreground text-[10px]">{r.data.invoice_number ?? ''}</div>
								</td>
								<td class="text-foreground px-3 py-2">
									<span class="font-medium">{r.data.soll_konto ?? '—'}</span>
									<span class="text-muted-foreground">· {r.data.soll_bezeichnung ?? ''}</span>
									{#if r.data.is_split && r.data.lines?.length}
										<span class="bg-muted text-muted-foreground ml-1 rounded px-1 py-0.5 text-[9px]"
											>+{r.data.lines.length - 1}
											Split</span
										>
									{/if}
								</td>
								<td class="text-muted-foreground px-3 py-2">{r.data.haben_konto ?? '—'}</td>
								<td class="text-muted-foreground px-3 py-2">{r.data.tax_key ?? '—'}</td>
								<td class="text-foreground px-3 py-2 text-right font-medium tabular-nums">
									{money(r.data.gross_amount)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p class="text-muted-foreground text-center text-[11px]">{t('mainnet.bookings.prüfHint')}</p>
		{/if}
	</div>
{/if}
