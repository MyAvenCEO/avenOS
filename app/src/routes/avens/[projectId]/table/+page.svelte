<script lang="ts">
import { t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow } from '$lib/ingestor/orders-store.svelte'
import { formatDate, formatEur, formatTime } from '../orders/orders-data'

const MAX_ROWS = 500

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

const shown = $derived(rows.slice(0, MAX_ROWS))
</script>

<div class="flex min-h-0 flex-col gap-4">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.orderTable')}</h1>
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
		{#if shown.length < rows.length}
			<p class="text-muted-foreground/70 text-[11px]">
				{t('avens.orders.showingCapped', { shown: shown.length, total: rows.length })}
			</p>
		{/if}
		<div class="border-input overflow-auto rounded-xl border">
			<table class="w-full border-collapse text-left text-[12px]">
				<thead class="bg-muted/50 text-muted-foreground sticky top-0">
					<tr class="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium [&>th]:whitespace-nowrap">
						<th>{t('avens.orderTable.col.time')}</th>
						<th>{t('avens.orderTable.col.invoice')}</th>
						<th>{t('avens.orderTable.col.order')}</th>
						<th>{t('avens.orderTable.col.location')}</th>
						<th>{t('avens.orderTable.col.server')}</th>
						<th>{t('avens.orderTable.col.product')}</th>
						<th>{t('avens.orderTable.col.category')}</th>
						<th class="text-right">{t('avens.orderTable.col.qty')}</th>
						<th class="text-right">{t('avens.orderTable.col.price')}</th>
						<th class="text-right">{t('avens.orderTable.col.total')}</th>
						<th>{t('avens.orderTable.col.vat')}</th>
						<th>{t('avens.orderTable.col.note')}</th>
					</tr>
				</thead>
				<tbody>
					{#each shown as r (r.lineId)}
						<tr
							class="border-border/40 hover:bg-muted/30 border-t [&>td]:px-3 [&>td]:py-1.5 [&>td]:whitespace-nowrap"
						>
							<td class="text-muted-foreground tabular-nums">
								{formatDate(r.orderedAt)}
								· {formatTime(r.orderedAt)}
							</td>
							<td class="font-mono text-[11px]">{r.invoiceNo}</td>
							<td class="font-mono text-[11px]">#{r.orderId}</td>
							<td>{r.location}</td>
							<td>{r.server}</td>
							<td class="font-medium">
								{r.product}
								{#if r.toGo}
									<span
										class="ml-1 rounded bg-sky-500/15 px-1 py-0.5 text-[9px] font-semibold tracking-wide text-sky-600 dark:text-sky-400"
										>{t('avens.orders.toGo')}</span
									>
								{/if}
							</td>
							<td class="text-muted-foreground">{r.category}</td>
							<td class="text-right tabular-nums">{r.qty}</td>
							<td class="text-right tabular-nums">{formatEur(r.price)}</td>
							<td class="text-right font-medium tabular-nums">{formatEur(r.total)}</td>
							<td class="text-muted-foreground">{r.vat}</td>
							<td class="text-muted-foreground">{r.note}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
