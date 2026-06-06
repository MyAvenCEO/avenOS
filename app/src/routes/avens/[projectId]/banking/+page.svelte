<script lang="ts">
import { t } from '$lib/i18n'
import { formatDate, formatEur } from '../orders/orders-data'
import { type BankProvider, PROVIDERS, providerById, TRANSACTIONS } from './banking-data'

// Right-aside filter — 'all' is the default global view.
let selected = $state<string>('all')

const totalBalance = $derived(PROVIDERS.reduce((s, p) => s + p.balance, 0))
/** Positive balances only, for the proportional split bar. */
const positiveTotal = $derived(PROVIDERS.reduce((s, p) => s + Math.max(0, p.balance), 0))

const filtered = $derived(
	[...TRANSACTIONS]
		.filter((tx) => selected === 'all' || tx.providerId === selected)
		.sort((a, b) => b.date.localeCompare(a.date))
)

const flowIn = $derived(filtered.reduce((s, tx) => (tx.amount > 0 ? s + tx.amount : s), 0))
const flowOut = $derived(filtered.reduce((s, tx) => (tx.amount < 0 ? s + tx.amount : s), 0))
const flowNet = $derived(flowIn + flowOut)

const activeProvider = $derived<BankProvider | undefined>(
	selected === 'all' ? undefined : providerById(selected)
)
const shownBalance = $derived(activeProvider ? activeProvider.balance : totalBalance)
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<header class="space-y-2">
		<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="text-xl font-semibold tracking-tight">{t('nav.banking')}</h1>
			<span class="text-muted-foreground text-xs">{t('avens.banking.providerCount', { count: PROVIDERS.length })}</span>
		</div>
		<p class="text-muted-foreground text-sm">{t('avens.banking.subtitle')}</p>
	</header>

	<!-- Combined balance + provider split bar -->
	<div class="border-input rounded-xl border bg-card/40 p-4">
		<p class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
			{activeProvider ? activeProvider.name : t('avens.banking.totalBalance')}
		</p>
		<p class="mt-1 text-2xl font-semibold tabular-nums">{formatEur(shownBalance)}</p>
		<div class="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-border/40">
			{#each PROVIDERS as p (p.id)}
				{#if p.balance > 0}
					<div
						class="{p.accent} h-full transition-opacity {selected !== 'all' && selected !== p.id ? 'opacity-25' : ''}"
						style="width: {(p.balance / positiveTotal) * 100}%"
						title={`${p.name} · ${formatEur(p.balance)}`}
					></div>
				{/if}
			{/each}
		</div>
		<div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
			{#each PROVIDERS as p (p.id)}
				<span class="flex items-center gap-1.5 text-[11px]">
					<span class="h-2 w-2 rounded-full {p.accent}"></span>
					<span class="text-muted-foreground">{p.name}</span>
					<span class="tabular-nums">{formatEur(p.balance)}</span>
				</span>
			{/each}
		</div>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
		<!-- Right aside: filter by provider (global default) -->
		<aside class="lg:order-last lg:w-56 lg:shrink-0">
			<div class="border-input overflow-hidden rounded-xl border bg-card/40">
				<p class="bg-muted/40 text-muted-foreground border-b border-border/60 px-3 py-2 text-[11px] font-semibold tracking-wide uppercase">
					{t('avens.banking.filterTitle')}
				</p>
				<ul>
					<li>
						<button
							type="button"
							onclick={() => (selected = 'all')}
							class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 {selected === 'all' ? 'bg-muted/60 font-semibold' : ''}"
						>
							<span>{t('avens.banking.allProviders')}</span>
							<span class="text-muted-foreground tabular-nums text-[11px]">{formatEur(totalBalance)}</span>
						</button>
					</li>
					{#each PROVIDERS as p (p.id)}
						<li class="border-t border-border/40">
							<button
								type="button"
								onclick={() => (selected = p.id)}
								class="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/40 {selected === p.id ? 'bg-muted/60 font-semibold' : ''}"
							>
								<span class="flex min-w-0 items-center gap-2">
									<span class="h-2 w-2 shrink-0 rounded-full {p.accent}"></span>
									<span class="truncate">{p.name}</span>
								</span>
								<span class="text-muted-foreground tabular-nums text-[11px]">{formatEur(p.balance)}</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		</aside>

		<!-- Transactions -->
		<div class="border-input flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/40">
			<div class="bg-muted/40 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2.5">
				<span class="text-sm font-semibold">
					{activeProvider ? activeProvider.name : t('avens.banking.allProviders')}
					<span class="text-muted-foreground text-[11px] font-normal">· {t('avens.banking.txnCount', { count: filtered.length })}</span>
				</span>
				<span class="flex items-baseline gap-3 text-[11px] tabular-nums">
					<span class="text-emerald-600">+{formatEur(flowIn)}</span>
					<span class="text-red-600">{formatEur(flowOut)}</span>
					<span class="font-semibold {flowNet >= 0 ? 'text-emerald-600' : 'text-red-600'}">
						{t('avens.banking.net')} {flowNet >= 0 ? '+' : ''}{formatEur(flowNet)}
					</span>
				</span>
			</div>
			<ul class="divide-border/40 min-h-0 flex-1 divide-y overflow-auto">
				{#each filtered as tx (tx.id)}
					{@const prov = providerById(tx.providerId)}
					<li class="flex items-center gap-3 px-4 py-2.5">
						<span class="text-muted-foreground w-20 shrink-0 text-[11px] tabular-nums">{formatDate(tx.date)}</span>
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate text-sm font-medium">{tx.description}</span>
							<span class="text-muted-foreground flex items-center gap-1.5 text-[11px]">
								{#if selected === 'all' && prov}
									<span class="h-1.5 w-1.5 rounded-full {prov.accent}"></span>
									<span>{prov.name}</span>
									<span>·</span>
								{/if}
								<span>{tx.category}</span>
							</span>
						</span>
						<span class="shrink-0 text-right text-sm font-semibold tabular-nums {tx.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}">
							{tx.amount >= 0 ? '+' : ''}{formatEur(tx.amount)}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</div>
