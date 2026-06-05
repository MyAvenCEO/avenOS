<script lang="ts">
import { t } from '$lib/i18n'
import ImportCsvButton from '$lib/ingestor/ImportCsvButton.svelte'
import { ordersFlow } from '$lib/ingestor/orders-store.svelte'
import VirtualList from '$lib/ingestor/VirtualList.svelte'
import { formatEur } from '../orders/orders-data'

interface ProductRow {
	key: string
	product: string
	vat: string
	unitNetto: number
	unitBrutto: number
	unitTax: number
	qty: number
	sumNetto: number
	sumTax: number
	sumBrutto: number
}

const GRID =
	'grid-template-columns: minmax(160px,1.6fr) 64px 100px 100px 100px 64px 110px 110px 120px'

/** "19 %" / "7,5%" → 0.19 / 0.075; anything unparseable → 0. */
function parseRate(v: string): number {
	const n = Number.parseFloat((v || '').replace('%', '').replace(',', '.').trim())
	return Number.isFinite(n) ? n / 100 : 0
}

const products = $derived.by<ProductRow[]>(() => {
	const m = new Map<string, ProductRow>()
	for (const o of ordersFlow.orders) {
		for (const l of o.lines) {
			// Same product name at a different unit price (or VAT) → separate row.
			const key = `${l.product}${l.price}${l.vat}`
			let r = m.get(key)
			if (!r) {
				const rate = parseRate(l.vat)
				const unitBrutto = l.price
				const unitNetto = rate > 0 ? unitBrutto / (1 + rate) : unitBrutto
				r = {
					key,
					product: l.product,
					vat: l.vat,
					unitBrutto,
					unitNetto,
					unitTax: unitBrutto - unitNetto,
					qty: 0,
					sumNetto: 0,
					sumTax: 0,
					sumBrutto: 0
				}
				m.set(key, r)
			}
			r.qty += l.qty
			r.sumBrutto += l.price * l.qty
		}
	}
	for (const r of m.values()) {
		r.sumNetto = r.unitNetto * r.qty
		r.sumTax = r.unitTax * r.qty
	}
	return [...m.values()].sort(
		(a, b) => b.sumBrutto - a.sumBrutto || a.product.localeCompare(b.product)
	)
})

const grand = $derived.by(() => {
	let netto = 0
	let tax = 0
	let brutto = 0
	for (const r of products) {
		netto += r.sumNetto
		tax += r.sumTax
		brutto += r.sumBrutto
	}
	return { netto, tax, brutto }
})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.products')}</h1>
			{#if products.length > 0}
				<span class="text-muted-foreground text-xs tabular-nums">
					{t('avens.products.count', { count: products.length })}
				</span>
			{/if}
			<div class="ml-auto"><ImportCsvButton compact /></div>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.products.subtitle')}</p>
	</header>

	{#if products.length === 0}
		<div
			class="border-input text-muted-foreground rounded-xl border border-dashed p-8 text-center text-sm"
		>
			{t('avens.products.empty')}
		</div>
	{:else}
		<div class="border-input flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
			<!-- Grand totals -->
			<div
				class="bg-muted/40 grid shrink-0 items-baseline gap-3 border-b border-border/60 px-4 py-2.5 text-xs font-semibold"
				style={GRID}
			>
				<span>{t('avens.products.grandTotal')}</span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span></span>
				<span class="text-right tabular-nums">{formatEur(grand.netto)}</span>
				<span class="text-right tabular-nums">{formatEur(grand.tax)}</span>
				<span class="text-right tabular-nums">{formatEur(grand.brutto)}</span>
			</div>
			<!-- Column header -->
			<div
				class="bg-muted/50 text-muted-foreground grid shrink-0 border-b border-border/60 text-[11px] font-medium [&>span]:truncate [&>span]:px-3 [&>span]:py-2"
				style={GRID}
			>
				<span>{t('avens.products.col.product')}</span>
				<span>{t('avens.products.col.vat')}</span>
				<span class="text-right">{t('avens.products.col.unitNetto')}</span>
				<span class="text-right">{t('avens.products.col.unitBrutto')}</span>
				<span class="text-right">{t('avens.products.col.unitTax')}</span>
				<span class="text-right">{t('avens.products.col.qty')}</span>
				<span class="text-right">{t('avens.products.col.sumNetto')}</span>
				<span class="text-right">{t('avens.products.col.sumTax')}</span>
				<span class="text-right">{t('avens.products.col.sumBrutto')}</span>
			</div>

			<VirtualList items={products} itemHeight={34}>
				{#snippet row(r: ProductRow)}
					<div
						class="border-border/40 hover:bg-muted/30 grid items-center border-b text-[12px] [&>span]:truncate [&>span]:px-3 [&>span]:py-2"
						style={GRID}
					>
						<span class="font-medium">{r.product}</span>
						<span class="text-muted-foreground">{r.vat}</span>
						<span class="text-right tabular-nums">{formatEur(r.unitNetto)}</span>
						<span class="text-right tabular-nums">{formatEur(r.unitBrutto)}</span>
						<span class="text-muted-foreground text-right tabular-nums"
							>{formatEur(r.unitTax)}</span
						>
						<span class="text-right tabular-nums">{r.qty}</span>
						<span class="text-right tabular-nums">{formatEur(r.sumNetto)}</span>
						<span class="text-muted-foreground text-right tabular-nums">{formatEur(r.sumTax)}</span>
						<span class="text-right font-semibold tabular-nums">{formatEur(r.sumBrutto)}</span>
					</div>
				{/snippet}
			</VirtualList>
		</div>
	{/if}
</div>
