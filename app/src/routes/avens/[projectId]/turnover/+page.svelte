<script lang="ts">
import { getLocale, t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow } from '$lib/ingestor/orders-store.svelte'
import { formatEur, orderTotal } from '../orders/orders-data'

interface MonthRow {
	key: string // YYYY-MM
	year: string
	label: string // localized "Month YYYY"
	total: number
	orders: number
}

function monthLabel(key: string): string {
	const [y, m] = key.split('-')
	const d = new Date(Number(y), Number(m) - 1, 1)
	try {
		return new Intl.DateTimeFormat(getLocale(), { month: 'long', year: 'numeric' }).format(d)
	} catch {
		return key
	}
}

// Brutto Umsatz (gross turnover incl. VAT) accumulated per calendar month,
// recognized on the payment date (Bezahldatum), falling back to the order date.
const months = $derived.by<MonthRow[]>(() => {
	const sums = new Map<string, { total: number; orders: number }>()
	for (const o of ordersFlow.orders) {
		const stamp = (o.paidAt || o.orderedAt || '').slice(0, 7)
		if (stamp.length !== 7) continue
		const cur = sums.get(stamp) ?? { total: 0, orders: 0 }
		cur.total += orderTotal(o)
		cur.orders += 1
		sums.set(stamp, cur)
	}
	return [...sums.entries()]
		.map(([key, v]) => ({
			key,
			year: key.slice(0, 4),
			label: monthLabel(key),
			total: v.total,
			orders: v.orders
		}))
		.sort((a, b) => b.key.localeCompare(a.key))
})

const grandTotal = $derived(months.reduce((s, m) => s + m.total, 0))
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.turnover')}</h1>
			<div class="ml-auto"><ImportCsvButton compact /></div>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.turnover.subtitle')}</p>
	</header>

	{#if months.length === 0}
		<div
			class="border-input text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
		>
			{t('avens.turnover.empty')}
		</div>
	{:else}
		<div class="border-input min-h-0 flex-1 overflow-auto rounded-xl border bg-card/40">
			<div
				class="bg-muted/40 flex items-baseline justify-between border-b border-border/60 px-4 py-3 text-sm font-semibold"
			>
				<span>{t('avens.turnover.grandTotal')}</span>
				<span class="tabular-nums">{formatEur(grandTotal)}</span>
			</div>
			<ul class="divide-border/40 divide-y">
				{#each months as m (m.key)}
					<li class="flex items-baseline justify-between px-4 py-3">
						<span class="flex items-baseline gap-2">
							<span class="font-medium capitalize">{m.label}</span>
							<span class="text-muted-foreground text-[11px] tabular-nums"
								>{m.orders} {t('avens.orders.items')}</span
							>
						</span>
						<span class="tabular-nums font-semibold">{formatEur(m.total)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
