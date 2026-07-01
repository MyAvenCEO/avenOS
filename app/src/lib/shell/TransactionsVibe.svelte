<script lang="ts">
import { createQuery } from '@tanstack/svelte-query'
import { listContacts, listType } from '$lib/data/client'
import { t } from '$lib/i18n'

// board 0068/0097 — live "all transactions" view. Now data-backed by the `transaction`≡pleji
// predications the bank-statement Kontoauszug flow writes (was the legacy flat `tx` schema): each row
// is amount (pleji x2), payee (x3 = the counterparty company, resolved to a name), Verwendungszweck
// (x4, projected as `invoice`) and the value/booking date (dated≡detri). Triggered by data_crud(list, tx/transaction).
let { containerName = 'aven-vibes-tx' }: { containerName?: string } = $props()

type Tx = {
	id: string
	amount?: string | number | null
	date?: string | null
	payee?: string | null
	invoice?: string | null
	account?: string | null
	matched_invoice?: string | null
}

const txQuery = createQuery(() => ({
	queryKey: ['data', 'values', 'transaction'],
	queryFn: () => listType<Tx>('transaction')
}))
const contactsQuery = createQuery(() => ({ queryKey: ['data', 'contacts'], queryFn: listContacts }))

const contactName = $derived(new Map((contactsQuery.data ?? []).map((c) => [c.id, c.data.name])))
const rows = $derived<Tx[]>(txQuery.data ?? [])
const num = (v: unknown): number | null =>
	typeof v === 'number' ? v : v == null || v === '' ? null : Number(v)
const sorted = $derived([...rows].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? ''))))
const total = $derived(rows.reduce((s, r) => s + (num(r.amount) ?? 0), 0))
const counterparty = (r: Tx): string => (r.payee ? (contactName.get(r.payee) ?? '—') : '—')

function money(n: number | null | undefined): string {
	if (typeof n !== 'number' || Number.isNaN(n)) return '—'
	return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<div
	class="bg-card mx-auto flex min-h-[200px] w-full max-w-2xl flex-col gap-3 rounded-[var(--radius-lg)] p-3"
	data-container={containerName}
>
	<div class="flex items-baseline justify-between">
		<h2 class="text-foreground text-lg font-semibold tracking-tight">
			{t('mainnet.transactions.title')}
		</h2>
		<span class="text-muted-foreground text-xs tabular-nums">
			{rows.length}
			{t('mainnet.transactions.count')}
			· {money(total)}
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
						<tr class="border-border/60 border-b last:border-0">
							<td class="text-foreground px-3 py-2 whitespace-nowrap tabular-nums">
								{r.date ?? '—'}
							</td>
							<td class="text-foreground px-3 py-2">{counterparty(r)}</td>
							<td class="px-3 py-2">
								{#if r.matched_invoice}
									<span class="rounded-full bg-blue-900/90 px-1.5 py-0.5 text-[9px] font-semibold text-blue-50"
										>{t('mainnet.transactions.belegt')}</span
									>
								{:else}
									<span class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
										>{t('mainnet.transactions.offen')}</span
									>
								{/if}
							</td>
							<td class="text-muted-foreground max-w-[24rem] truncate px-3 py-2">
								{r.invoice ?? '—'}
							</td>
							<td
								class="px-3 py-2 text-right font-medium tabular-nums {(num(r.amount) ?? 0) < 0
									? 'text-destructive'
									: 'text-foreground'}"
							>
								{money(num(r.amount))}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
