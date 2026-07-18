<script lang="ts">
import { TX_SCHEMA } from '@avenos/aven-vibes/tx'
import { createQuery } from '@tanstack/svelte-query'
import { type DataValue, ensureSchema, listSchemas, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// board 0068/0081 — live "all transactions" view. Data-backed like TodosVibe: reads the `tx` schema's
// values from the betterauth /api/data store (the same rows the bank-statement fan-out writes, 0065)
// and renders them as a table — plus a Status column derived from the `match` + `booking` records:
// "Belegt" (a Beleg/invoice is linked) and "Verbucht" (posted to a konto). Triggered by
// data_crud(list, 'tx').
let { containerName = 'aven-vibes-tx' }: { containerName?: string } = $props()

type Tx = {
	dedup_key?: string
	booking_date?: string | null
	value_date?: string | null
	amount?: number | null
	currency?: string | null
	description?: string | null
	counterparty_name?: string | null
	counterparty_iban?: string | null
	balance_after?: number | null
	account_iban?: string | null
}
type Match = {
	tx_dedup_key?: string | null
	invoice_value_id?: string | null
	status?: string | null
}
type Booking = {
	invoice_value_id?: string | null
	status?: string | null
	confidence?: string | null
}

// Account-pick confidence labels (mirrors the booking views). board 0080/0082.
const CONF: Record<string, { label: string; cls: string }> = {
	high: { label: 'Sicher', cls: 'bg-green-900/90 text-green-50' },
	medium: { label: 'Mittel', cls: 'bg-amber-900/90 text-amber-50' },
	low: { label: 'Unsicher', cls: 'bg-red-900/90 text-red-50' }
}

let schemaId = $state<string | null>(null)
let matchSchemaId = $state<string | null>(null)
let bookingSchemaId = $state<string | null>(null)
let err = $state<string | null>(null)
let started = false

// Ensure the `tx` schema exists (idempotent) so the list works even before the first statement; the
// match/booking schemas already exist once the pipeline has run — just find their ids.
$effect(() => {
	if (started) return
	started = true
	void (async () => {
		try {
			schemaId = await ensureSchema('tx', TX_SCHEMA as unknown as Record<string, unknown>)
			const schemas = await listSchemas()
			matchSchemaId = schemas.find((s) => s.name === 'match')?.id ?? null
			bookingSchemaId = schemas.find((s) => s.name === 'booking')?.id ?? null
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		}
	})()
})

const valuesQuery = createQuery(() => ({
	queryKey: schemaId ? qk.values(schemaId) : ['data', 'values', 'tx-pending'],
	queryFn: () => listValues<Tx>(schemaId as string),
	enabled: !!schemaId
}))
const matchesQuery = createQuery(() => ({
	queryKey: matchSchemaId ? qk.values(matchSchemaId) : ['data', 'values', 'match-pending'],
	queryFn: () => listValues<Match>(matchSchemaId as string),
	enabled: !!matchSchemaId
}))
const bookingsQuery = createQuery(() => ({
	queryKey: bookingSchemaId ? qk.values(bookingSchemaId) : ['data', 'values', 'booking-pending'],
	queryFn: () => listValues<Booking>(bookingSchemaId as string),
	enabled: !!bookingSchemaId
}))

// invoice_value_id → its posted booking's account-pick confidence; and the invoice each tx links to.
const bookingConfByInvoice = $derived(
	new Map(
		(bookingsQuery.data ?? [])
			.filter((b) => b.data.status === 'booked' && b.data.invoice_value_id)
			.map((b) => [b.data.invoice_value_id as string, b.data.confidence ?? 'medium'])
	)
)
const matchByTx = $derived(
	new Map(
		(matchesQuery.data ?? [])
			.filter((m) => m.data.status === 'matched' && m.data.tx_dedup_key)
			.map((m) => [m.data.tx_dedup_key as string, m.data.invoice_value_id ?? null])
	)
)
// Reconciliation state for one tx: belegt (Beleg/invoice linked), verbucht (booked) + the booking's
// account-pick confidence.
function txStatus(dedupKey: string | undefined): {
	belegt: boolean
	verbucht: boolean
	confidence: string | null
} {
	if (!dedupKey || !matchByTx.has(dedupKey))
		return { belegt: false, verbucht: false, confidence: null }
	const invId = matchByTx.get(dedupKey) ?? null
	const conf = invId ? (bookingConfByInvoice.get(invId) ?? null) : null
	return { belegt: true, verbucht: !!invId && bookingConfByInvoice.has(invId), confidence: conf }
}

const rows = $derived<DataValue<Tx>[]>(valuesQuery.data ?? [])
const sorted = $derived(
	[...rows].sort((a, b) =>
		String(b.data.booking_date ?? b.data.value_date ?? '').localeCompare(
			String(a.data.booking_date ?? a.data.value_date ?? '')
		)
	)
)
const currency = $derived(rows.find((r) => r.data.currency)?.data.currency ?? '')
const total = $derived(
	rows.reduce((s, r) => s + (typeof r.data.amount === 'number' ? r.data.amount : 0), 0)
)

function money(n: number | null | undefined): string {
	if (typeof n !== 'number') return '—'
	return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<div
	class="mx-auto flex min-h-[200px] w-full max-w-2xl flex-col gap-3"
	data-container={containerName}
>
	{#if err}
		<p class="text-destructive text-sm" role="alert">{err}</p>
	{/if}

	<div class="flex items-baseline justify-between">
		<h2 class="text-foreground text-lg font-semibold tracking-tight">
			{t('mainnet.transactions.title')}
		</h2>
		<span class="text-muted-foreground text-xs tabular-nums">
			{rows.length}
			{t('mainnet.transactions.count')}
			· {money(total)}
			{currency}
		</span>
	</div>

	{#if rows.length === 0}
		<p class="text-muted-foreground py-8 text-center text-sm">
			{t('mainnet.transactions.empty')}
		</p>
	{:else}
		<div class="border-border overflow-x-auto rounded-[var(--radius-lg)] border">
			<table class="w-full border-collapse text-xs">
				<thead>
					<tr class="text-muted-foreground border-border border-b text-left">
						<th class="px-3 py-2 font-semibold">{t('mainnet.transactions.date')}</th>
						<th class="px-3 py-2 font-semibold">{t('mainnet.transactions.counterparty')}</th>
						<th class="px-3 py-2 font-semibold">{t('mainnet.transactions.status')}</th>
						<th class="px-3 py-2 font-semibold">{t('mainnet.transactions.purpose')}</th>
						<th class="px-3 py-2 text-right font-semibold">{t('mainnet.transactions.amount')}</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as r (r.id)}
						{@const st = txStatus(r.data.dedup_key)}
						<tr class="border-border/60 border-b last:border-0">
							<td class="text-foreground px-3 py-2 whitespace-nowrap tabular-nums">
								{r.data.booking_date ?? r.data.value_date ?? '—'}
							</td>
							<td class="text-foreground px-3 py-2">
								{r.data.counterparty_name ?? r.data.counterparty_iban ?? '—'}
							</td>
							<td class="px-3 py-2">
								<div class="flex flex-wrap gap-1">
									{#if st.belegt}
										<span
											class="rounded-full bg-blue-900/90 px-1.5 py-0.5 text-[9px] font-semibold text-blue-50"
											>{t('mainnet.transactions.belegt')}</span
										>
									{/if}
									{#if st.verbucht}
										<span
											class="rounded-full bg-green-900/90 px-1.5 py-0.5 text-[9px] font-semibold text-green-50"
											>{t('mainnet.transactions.verbucht')}</span
										>
										{#if st.confidence && CONF[st.confidence]}
											<span
												class="rounded-full px-1.5 py-0.5 text-[9px] font-semibold {CONF[st.confidence]
													.cls}"
												>{CONF[st.confidence].label}</span
											>
										{/if}
									{/if}
									{#if !st.belegt && !st.verbucht}
										<span
											class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
											>{t('mainnet.transactions.offen')}</span
										>
									{/if}
								</div>
							</td>
							<td class="text-muted-foreground max-w-[24rem] truncate px-3 py-2">
								{r.data.description ?? '—'}
							</td>
							<td
								class="px-3 py-2 text-right font-medium tabular-nums {typeof r.data.amount ===
									'number' && r.data.amount < 0
									? 'text-destructive'
									: 'text-foreground'}"
							>
								{money(r.data.amount)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
