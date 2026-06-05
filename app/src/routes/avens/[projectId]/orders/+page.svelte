<script lang="ts">
import { t } from '$lib/i18n'
import { ingestOrdersCsv } from '$lib/ingestor/victorio-orders'
import {
	formatDate,
	formatEur,
	formatTime,
	ORDERS,
	type Order,
	orderItemCount,
	orderTotal
} from './orders-data'

// Imported orders replace the hardcoded sample once the first CSV is ingested.
let imported = $state<Order[] | null>(null)
let importMsg = $state<string | null>(null)
let importing = $state(false)

const orders = $derived(
	[...(imported ?? ORDERS)].sort((a, b) => b.orderedAt.localeCompare(a.orderedAt))
)
const isImported = $derived(imported !== null)

function statusLabel(o: Order): string {
	return o.status === 'paid' ? t('avens.orders.paid') : t('avens.orders.open')
}

async function onPickFile(event: Event): Promise<void> {
	const input = event.currentTarget as HTMLInputElement
	const file = input.files?.[0]
	if (!file) return
	importing = true
	importMsg = null
	try {
		const { orders: next, report } = await ingestOrdersCsv(file)
		imported = next
		if (report.duplicateFile) {
			importMsg = t('avens.orders.importDuplicate')
		} else {
			const added = Object.values(report.stats).reduce((s, x) => s + x.added, 0)
			const skipped = Object.values(report.stats).reduce((s, x) => s + x.skipped, 0)
			importMsg =
				next.length === 0
					? t('avens.orders.importEmpty')
					: t('avens.orders.imported', { added, skipped })
		}
	} catch (e) {
		importMsg = t('avens.orders.importError', {
			message: e instanceof Error ? e.message : String(e)
		})
	} finally {
		importing = false
		input.value = ''
	}
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
			<label
				class="border-input bg-card/40 hover:bg-card/70 ml-auto cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors {importing
					? 'pointer-events-none opacity-60'
					: ''}"
			>
				{t('avens.orders.import')}
				<input type="file" accept=".csv,text/csv" class="hidden" onchange={onPickFile}>
			</label>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.orders.subtitle')}</p>
		{#if importMsg}
			<p class="text-muted-foreground text-xs">{importMsg}</p>
		{:else}
			<p class="text-muted-foreground/70 text-[11px]">{t('avens.orders.importHint')}</p>
		{/if}
	</header>

	<ul class="flex flex-col gap-3">
		{#each orders as order (order.id)}
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
					{#each order.lines as line (line.positionId)}
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
