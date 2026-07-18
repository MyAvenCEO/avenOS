<script lang="ts">
import { BOOKING_SCHEMA } from '@avenos/aven-vibes/booking'
import { TX_SCHEMA } from '@avenos/aven-vibes/tx'
import { createQuery } from '@tanstack/svelte-query'
import { type DataValue, ensureSchema, listValues } from '$lib/data/client'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// board 0072 — BWA / Jahresabschluss-like realtime finance snapshot computed from the user's stored
// bookings (P&L by SKR04 account) + transactions (cash flow). Data-backed; refreshes live as new
// invoices are booked / statements extracted. Openable from the Vibes tab or via chat ("BWA").
let { containerName = 'aven-vibes-bwa' }: { containerName?: string } = $props()

type BookingLine = {
	soll_konto?: string | null
	soll_bezeichnung?: string | null
	net_amount?: number | null
	gross_amount?: number | null
}
type Booking = {
	soll_konto?: string | null
	soll_bezeichnung?: string | null
	haben_konto?: string | null
	haben_bezeichnung?: string | null
	lines?: BookingLine[] | null
	gross_amount?: number | null
	net_amount?: number | null
	tax_amount?: number | null
	currency?: string | null
	status?: string | null
}
type Tx = { amount?: number | null; currency?: string | null }

let bookingSchemaId = $state<string | null>(null)
let txSchemaId = $state<string | null>(null)
let started = false

$effect(() => {
	if (started) return
	started = true
	void (async () => {
		try {
			bookingSchemaId = await ensureSchema(
				'booking',
				BOOKING_SCHEMA as unknown as Record<string, unknown>
			)
			txSchemaId = await ensureSchema('tx', TX_SCHEMA as unknown as Record<string, unknown>)
		} catch {
			/* ignore */
		}
	})()
})

const bookingsQuery = createQuery(() => ({
	queryKey: bookingSchemaId ? qk.values(bookingSchemaId) : ['data', 'values', 'bwa-bk'],
	queryFn: () => listValues<Booking>(bookingSchemaId as string),
	enabled: !!bookingSchemaId
}))
const txQuery = createQuery(() => ({
	queryKey: txSchemaId ? qk.values(txSchemaId) : ['data', 'values', 'bwa-tx'],
	queryFn: () => listValues<Tx>(txSchemaId as string),
	enabled: !!txSchemaId
}))

const bookings = $derived<DataValue<Booking>[]>(bookingsQuery.data ?? [])
const txs = $derived<DataValue<Tx>[]>(txQuery.data ?? [])
const currency = $derived(
	bookings.find((b) => b.data.currency)?.data.currency ??
		txs.find((x) => x.data.currency)?.data.currency ??
		'EUR'
)

// Classify a Soll account: 4xxx → revenue, 6xxx/7xxx → expense, else expense by default.
function kindOf(konto: string): 'erloes' | 'aufwand' | null {
	if (konto.startsWith('4')) return 'erloes'
	if (konto.startsWith('6') || konto.startsWith('7')) return 'aufwand'
	return konto ? 'aufwand' : null
}

// Expand a booking into its Soll positions (split lines, else the flat single line). board 0073.
function positions(b: Booking): { konto: string; name: string; net: number }[] {
	const src: BookingLine[] =
		b.lines && b.lines.length
			? b.lines
			: [
					{
						soll_konto: b.soll_konto,
						soll_bezeichnung: b.soll_bezeichnung,
						net_amount: b.net_amount,
						gross_amount: b.gross_amount
					}
				]
	return src.map((l) => ({
		konto: String(l.soll_konto ?? ''),
		name: String(l.soll_bezeichnung ?? ''),
		net:
			typeof l.net_amount === 'number'
				? l.net_amount
				: typeof l.gross_amount === 'number'
					? l.gross_amount
					: 0
	}))
}

type Group = { konto: string; name: string; net: number; n: number }

const pnl = $derived.by(() => {
	const aufwand = new Map<string, Group>()
	const erloes = new Map<string, Group>()
	let aufwandTotal = 0
	let erloesTotal = 0
	for (const row of bookings) {
		if (row.data.status && row.data.status !== 'booked') continue
		for (const p of positions(row.data)) {
			const kind = kindOf(p.konto)
			if (!kind) continue
			const bucket = kind === 'erloes' ? erloes : aufwand
			const g = bucket.get(p.konto) ?? { konto: p.konto, name: p.name, net: 0, n: 0 }
			g.net += p.net
			g.n += 1
			bucket.set(p.konto, g)
			if (kind === 'erloes') erloesTotal += p.net
			else aufwandTotal += p.net
		}
	}
	const sort = (m: Map<string, Group>) => [...m.values()].sort((x, y) => y.net - x.net)
	return {
		aufwand: sort(aufwand),
		erloes: sort(erloes),
		aufwandTotal,
		erloesTotal,
		ergebnis: erloesTotal - aufwandTotal
	}
})

const cash = $derived.by(() => {
	let ein = 0
	let aus = 0
	for (const x of txs) {
		const a = typeof x.data.amount === 'number' ? x.data.amount : 0
		if (a >= 0) ein += a
		else aus += a
	}
	return { ein, aus, saldo: ein + aus }
})

function money(n: number): string {
	return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4" data-container={containerName}>
	<h2 class="text-foreground text-lg font-semibold tracking-tight">{t('mainnet.finance.title')}</h2>

	<!-- KPIs -->
	<div class="grid grid-cols-3 gap-2">
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">
				{t('mainnet.finance.revenue')}
			</p>
			<p class="text-foreground mt-1 font-semibold tabular-nums">{money(pnl.erloesTotal)}</p>
		</div>
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">
				{t('mainnet.finance.expenses')}
			</p>
			<p class="text-destructive mt-1 font-semibold tabular-nums">{money(pnl.aufwandTotal)}</p>
		</div>
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">
				{t('mainnet.finance.result')}
			</p>
			<p
				class="mt-1 font-semibold tabular-nums {pnl.ergebnis < 0 ? 'text-destructive' : 'text-green-600'}"
			>
				{money(pnl.ergebnis)}
			</p>
		</div>
	</div>

	<!-- Cash flow from transactions -->
	<div
		class="border-border bg-card flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border p-3 text-xs"
	>
		<span class="text-muted-foreground">{t('mainnet.finance.cash')} ({currency})</span>
		<span class="text-green-600 tabular-nums">+{money(cash.ein)}</span>
		<span class="text-destructive tabular-nums">{money(cash.aus)}</span>
		<span class="text-foreground font-semibold tabular-nums">= {money(cash.saldo)}</span>
	</div>

	<!-- Expense breakdown by SKR04 account -->
	{#if pnl.aufwand.length}
		<div class="flex flex-col gap-1">
			<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
				{t('mainnet.finance.byAccount')}
			</p>
			<div class="border-border overflow-hidden rounded-[var(--radius-lg)] border">
				{#each pnl.aufwand as g (g.konto)}
					<div
						class="border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-0"
					>
						<span class="text-foreground min-w-0 truncate">
							<span class="font-medium">{g.konto}</span>
							<span class="text-muted-foreground">· {g.name}</span>
							<span class="text-muted-foreground">({g.n})</span>
						</span>
						<span class="text-foreground shrink-0 tabular-nums">{money(g.net)}</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<p class="text-muted-foreground py-6 text-center text-sm">{t('mainnet.finance.empty')}</p>
	{/if}
</div>
