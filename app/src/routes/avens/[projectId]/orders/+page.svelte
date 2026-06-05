<script lang="ts">
import { t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow } from '$lib/ingestor/orders-store.svelte'
import {
	formatDate,
	formatEur,
	formatTime,
	ORDERS,
	type Order,
	orderItemCount,
	orderTotal
} from './orders-data'

// Cap rendered cards — a real export has tens of thousands of orders.
const MAX_CARDS = 100

const isImported = $derived(ordersFlow.hasImport && ordersFlow.orderCount > 0)
const source = $derived(isImported ? ordersFlow.orders : ORDERS)
const sorted = $derived([...source].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt)))
const shown = $derived(sorted.slice(0, MAX_CARDS))

function statusLabel(o: Order): string {
	return o.status === 'paid' ? t('avens.orders.paid') : t('avens.orders.open')
}
</script>

<div class="flex flex-col gap-5">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.orders')}</h1>
			{#if isImported}
				<span
					class="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-sky-600 uppercase dark:text-sky-400"
				>
					{t('avens.orders.importedBadge')}
				</span>
			{/if}
			<div class="ml-auto"><ImportCsvButton compact /></div>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.orders.subtitle')}</p>
		{#if ordersFlow.error}
			<p class="text-xs text-red-600 dark:text-red-400">
				{t('avens.orders.importError', { message: ordersFlow.error })}
			</p>
		{:else if ordersFlow.duplicate}
			<p class="text-muted-foreground text-xs">{t('avens.orders.importDuplicate')}</p>
		{:else if isImported}
			<p class="text-muted-foreground text-xs">
				{t('avens.orders.summary', { orders: ordersFlow.orderCount, lines: ordersFlow.lineCount })}
			</p>
		{:else}
			<p class="text-muted-foreground/70 text-[11px]">{t('avens.orders.importHint')}</p>
		{/if}
	</header>

	{#if shown.length < sorted.length}
		<p class="text-muted-foreground/70 text-[11px]">
			{t('avens.orders.showingCapped', { shown: shown.length, total: sorted.length })}
		</p>
	{/if}

	<ul class="flex flex-col gap-3">
		{#each shown as order (order.id)}
			<li class="border-input overflow-hidden rounded-xl border bg-card/40">
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-3"
				>
					<span class="text-base font-semibold tracking-tight">{order.location}</span>
					<span
						class="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase {order.status ===
						'paid'
							? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
							: 'bg-amber-500/15 text-amber-600 dark:text-amber-400'}"
					>
						{statusLabel(order)}
					</span>
					<span class="text-muted-foreground ml-auto font-mono text-[11px]">
						{order.invoiceNo}
						· #{order.id}
					</span>
				</div>

				<div class="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 px-4 pt-2 text-[11px]">
					<span>{formatDate(order.orderedAt)} · {formatTime(order.orderedAt)}</span>
					<span>{t('avens.orders.server')}: {order.server}</span>
					<span>{orderItemCount(order)} {t('avens.orders.items')}</span>
				</div>

				<ul class="divide-border/40 mt-1 divide-y px-4 pb-1">
					{#each order.lines as line, li (line.lineId ?? `${line.positionId}-${li}`)}
						<li class="flex items-baseline gap-3 py-1.5 text-sm">
							<span class="text-muted-foreground w-6 shrink-0 text-right tabular-nums"
								>{line.qty}×</span
							>
							<span class="min-w-0 flex-1">
								<span class="font-medium">{line.product}</span>
								<span class="text-muted-foreground ml-2 text-[11px]">{line.category}</span>
								{#if line.note}
									<span
										class="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
										>{line.note}</span
									>
								{/if}
								{#if line.toGo}
									<span
										class="ml-2 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-sky-600 dark:text-sky-400"
										>{t('avens.orders.toGo')}</span
									>
								{/if}
							</span>
							<span class="shrink-0 tabular-nums">{formatEur(line.price * line.qty)}</span>
						</li>
					{/each}
				</ul>

				<div
					class="flex items-baseline justify-between border-t border-border/60 px-4 py-2.5 text-sm font-semibold"
				>
					<span>{t('avens.orders.total')}</span>
					<span class="tabular-nums">{formatEur(orderTotal(order))}</span>
				</div>
			</li>
		{/each}
	</ul>
</div>
