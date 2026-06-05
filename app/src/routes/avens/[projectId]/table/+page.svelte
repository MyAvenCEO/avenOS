<script lang="ts">
import { t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow } from '$lib/ingestor/orders-store.svelte'
import VirtualList from '$lib/ingestor/VirtualList.svelte'
import { formatDate, formatEur, formatTime } from '../orders/orders-data'

interface Row {
	lineId: number | string
	orderedAt: string
	invoiceNo: string
	orderId: number
	location: string
	server: string
	product: string
	category: string
	vat: string
	qty: number
	price: number
	total: number
	note: string
	toGo: boolean
}

// Shared column template so the header and every row line up.
const GRID =
	'grid-template-columns: 128px 84px 76px 96px 72px minmax(150px,1.4fr) 112px 48px 84px 84px 56px minmax(110px,1fr)'

const rows = $derived.by<Row[]>(() => {
	const out: Row[] = []
	let n = 0
	for (const o of ordersFlow.orders) {
		for (const l of o.lines) {
			out.push({
				lineId: l.lineId ?? `${o.id}-${n++}`,
				orderedAt: o.orderedAt,
				invoiceNo: o.invoiceNo,
				orderId: o.id,
				location: o.location,
				server: o.server,
				product: l.product,
				category: l.category,
				vat: l.vat,
				qty: l.qty,
				price: l.price,
				total: l.price * l.qty,
				note: l.note ?? '',
				toGo: !!l.toGo
			})
		}
	}
	return out.sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.orderTable')}</h1>
			{#if rows.length > 0}
				<span class="text-muted-foreground text-xs tabular-nums">
					{t('avens.orders.summary', {
						orders: ordersFlow.orderCount,
						lines: ordersFlow.lineCount
					})}
				</span>
			{/if}
			<div class="ml-auto"><ImportCsvButton compact /></div>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.orderTable.subtitle')}</p>
	</header>

	{#if rows.length === 0}
		<div
			class="border-input text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
		>
			{t('avens.orderTable.empty')}
		</div>
	{:else}
		<div class="border-input flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
			<!-- Header (stays put; the body below scrolls) -->
			<div
				class="bg-muted/50 text-muted-foreground grid shrink-0 gap-0 border-b border-border/60 text-[11px] font-medium [&>span]:truncate [&>span]:px-3 [&>span]:py-2"
				style={GRID}
			>
				<span>{t('avens.orderTable.col.time')}</span>
				<span>{t('avens.orderTable.col.invoice')}</span>
				<span>{t('avens.orderTable.col.order')}</span>
				<span>{t('avens.orderTable.col.location')}</span>
				<span>{t('avens.orderTable.col.server')}</span>
				<span>{t('avens.orderTable.col.product')}</span>
				<span>{t('avens.orderTable.col.category')}</span>
				<span class="text-right">{t('avens.orderTable.col.qty')}</span>
				<span class="text-right">{t('avens.orderTable.col.price')}</span>
				<span class="text-right">{t('avens.orderTable.col.total')}</span>
				<span>{t('avens.orderTable.col.vat')}</span>
				<span>{t('avens.orderTable.col.note')}</span>
			</div>

			<VirtualList items={rows} itemHeight={33}>
				{#snippet row(r: Row)}
					<div
						class="border-border/40 hover:bg-muted/30 grid items-center border-b text-[12px] [&>span]:truncate [&>span]:px-3 [&>span]:py-1.5"
						style={GRID}
					>
						<span class="text-muted-foreground tabular-nums"
							>{formatDate(r.orderedAt)}
							· {formatTime(r.orderedAt)}</span
						>
						<span class="font-mono text-[11px]">{r.invoiceNo}</span>
						<span class="font-mono text-[11px]">#{r.orderId}</span>
						<span>{r.location}</span>
						<span>{r.server}</span>
						<span class="font-medium">
							{r.product}
							{#if r.toGo}
								<span class="text-sky-600 dark:text-sky-400">· {t('avens.orders.toGo')}</span>
							{/if}
						</span>
						<span class="text-muted-foreground">{r.category}</span>
						<span class="text-right tabular-nums">{r.qty}</span>
						<span class="text-right tabular-nums">{formatEur(r.price)}</span>
						<span class="text-right font-medium tabular-nums">{formatEur(r.total)}</span>
						<span class="text-muted-foreground">{r.vat}</span>
						<span class="text-muted-foreground">{r.note}</span>
					</div>
				{/snippet}
			</VirtualList>
		</div>
	{/if}
</div>
