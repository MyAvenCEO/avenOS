<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { listType } from '$lib/data/client'
import { t } from '$lib/i18n'

// board 0072/0098 — BWA / finance snapshot, now computed entirely from the `transaction`≡pleji
// predications (was the legacy flat `tx` + `booking` schemas). Cash flow = the signed amounts; the P&L
// groups the booked transactions by their SKR04 account (`booked`≡cmima, single-entry): 4xxx = Erlöse,
// 6xxx/7xxx = Aufwand. Refreshes live as statements are imported + transactions booked.
let { containerName = 'aven-vibes-bwa' }: { containerName?: string } = $props()

type Tx = { id: string; amount?: string | number | null; currency?: string | null; account?: string | null }

const txQuery = createQuery(() => ({
	queryKey: ['data', 'values', 'transaction'],
	queryFn: () => listType<Tx>('transaction')
}))
const txs = $derived<Tx[]>(txQuery.data ?? [])
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
const currency = $derived(txs.find((x) => x.currency)?.currency ?? 'EUR')

// Classify an SKR04 Soll account: 4xxx → revenue, 6xxx/7xxx → expense.
function kindOf(konto: string): 'erloes' | 'aufwand' | null {
	if (konto.startsWith('4')) return 'erloes'
	if (konto.startsWith('6') || konto.startsWith('7')) return 'aufwand'
	return konto ? 'aufwand' : null
}

type Group = { konto: string; net: number; n: number }
const pnl = $derived.by(() => {
	const aufwand = new Map<string, Group>()
	const erloes = new Map<string, Group>()
	let aufwandTotal = 0
	let erloesTotal = 0
	for (const tx of txs) {
		const konto = String(tx.account ?? '')
		const kind = kindOf(konto)
		if (!kind) continue
		const net = Math.abs(num(tx.amount))
		const bucket = kind === 'erloes' ? erloes : aufwand
		const g = bucket.get(konto) ?? { konto, net: 0, n: 0 }
		g.net += net
		g.n += 1
		bucket.set(konto, g)
		if (kind === 'erloes') erloesTotal += net
		else aufwandTotal += net
	}
	const sort = (m: Map<string, Group>) => [...m.values()].sort((x, y) => y.net - x.net)
	return { aufwand: sort(aufwand), erloesTotal, aufwandTotal, ergebnis: erloesTotal - aufwandTotal }
})

const cash = $derived.by(() => {
	let ein = 0
	let aus = 0
	for (const tx of txs) {
		const a = num(tx.amount)
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

	<div class="grid grid-cols-3 gap-2">
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">{t('mainnet.finance.revenue')}</p>
			<p class="text-foreground mt-1 font-semibold tabular-nums">{money(pnl.erloesTotal)}</p>
		</div>
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">{t('mainnet.finance.expenses')}</p>
			<p class="text-destructive mt-1 font-semibold tabular-nums">{money(pnl.aufwandTotal)}</p>
		</div>
		<div class="border-border bg-card rounded-[var(--radius-lg)] border p-3">
			<p class="text-muted-foreground text-[10px] tracking-wide uppercase">{t('mainnet.finance.result')}</p>
			<p class="mt-1 font-semibold tabular-nums {pnl.ergebnis < 0 ? 'text-destructive' : 'text-green-600'}">
				{money(pnl.ergebnis)}
			</p>
		</div>
	</div>

	<div class="border-border bg-card flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border p-3 text-xs">
		<span class="text-muted-foreground">{t('mainnet.finance.cash')} ({currency})</span>
		<span class="text-green-600 tabular-nums">+{money(cash.ein)}</span>
		<span class="text-destructive tabular-nums">{money(cash.aus)}</span>
		<span class="text-foreground font-semibold tabular-nums">= {money(cash.saldo)}</span>
	</div>

	{#if pnl.aufwand.length}
		<div class="flex flex-col gap-1">
			<p class="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
				{t('mainnet.finance.byAccount')}
			</p>
			<div class="border-border overflow-hidden rounded-[var(--radius-lg)] border">
				{#each pnl.aufwand as g (g.konto)}
					<div class="border-border/60 flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-0">
						<span class="text-foreground min-w-0 truncate">
							<span class="font-medium">{g.konto}</span>
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
