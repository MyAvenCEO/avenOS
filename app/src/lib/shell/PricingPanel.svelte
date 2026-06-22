<script lang="ts">
import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query'
import { authClient } from '$lib/auth/auth-client'
import {
	type BillingState,
	type BillingSubscription,
	cancelSubscription,
	fetchBillingState,
	fetchInvoiceBlobUrl,
	startCheckout,
	switchSubscription,
	uncancelSubscription
} from '$lib/billing/checkout'
import { weeklyMindsLabel } from '$lib/billing/minds'
import { getLocale, t } from '$lib/i18n'
import { qk } from '$lib/query/client'

// Pricing + full self-service plan management in OUR own UI (no Polar-hosted portal). Paid tiers
// are data-driven (TIER_LIST); each card computes book / upgrade / downgrade / current from the
// user's tier + rank. Subscriptions + orders and all manage actions go through /api/billing/*
// which proxies the Polar SDK server-side. board 0052.
// Tiers are data-driven by RANK only. Price + feature bullets both come LIVE from Polar
// (billing.prices / billing.benefits); `eur` is just a load-time price fallback. board 0052/0055.
type TierCfg = { id: string; eur: number; rank: number }
const TIER_LIST: TierCfg[] = [
	{ id: 'avenME', eur: 7, rank: 1 },
	{ id: 'avenFOUNDER', eur: 34, rank: 2 },
	{ id: 'avenCEO', eur: 377, rank: 3 }
]
const RANK: Record<string, number> = Object.fromEntries(TIER_LIST.map((x) => [x.id, x.rank]))

// Which half to render: 'plans' = the pricing cards; 'billing' = subscriptions, orders, invoices.
// Account Settings mounts this once per category (Plans / Billing). board 0055.
let { section = 'plans' }: { section?: 'plans' | 'billing' } = $props()

const sessionStore = authClient.useSession()
const queryClient = useQueryClient()

// Subscriptions + orders + tier, live via TanStack Query. The SSE 'billing' event (published on
// every server-side billing change incl. the webhook) invalidates this — no manual reload. board 0055.
const billingQuery = createQuery(() => ({ queryKey: qk.billing, queryFn: fetchBillingState }))
const billing = $derived<BillingState | null>(billingQuery.data ?? null)

// Current tier from the live billing state (server-reconciled), falling back to the session.
const currentTier = $derived(
	billing?.tier ?? ($sessionStore.data?.user as { tier?: string } | undefined)?.tier ?? 'free'
)

let error = $state<string | null>(null)
let bookBusy = $state(false)
let confirmCancel = $state(false)
// Invoice preview: a `blob:` URL (PDF) shown in a modal; null when closed.
let invoiceUrl = $state<string | null>(null)
let invoiceBusyId = $state<string | null>(null)

// The active paid subscription (drives cancel/resume + the period-end date).
const activeSub = $derived(
	billing?.subscriptions.find(
		(s) => (s.status === 'active' || s.status === 'trialing') && s.tier !== null && RANK[s.tier]
	) ?? null
)

// What the button on a given tier card should do, from the current tier + ranks.
function actionFor(tierId: string): 'current' | 'book' | 'upgrade' | 'downgrade' {
	if (currentTier === tierId) return 'current'
	if (!activeSub || currentTier === 'free') return 'book'
	return (RANK[tierId] ?? 0) > (RANK[currentTier] ?? 0) ? 'upgrade' : 'downgrade'
}

// Weekly price label, live from Polar (billing.prices) — falls back to the static TIER_LIST value
// only until the state loads, so a Polar repricing shows up here with no code change. board 0052.
function priceLabel(tierId: string, fallbackEur: number): string {
	const eur = billing?.prices?.[tierId] ?? fallbackEur
	return `€${Number.isInteger(eur) ? eur : eur.toFixed(2)}`
}

// Card bullets = a derived MINDS line (from the live price) + the tier's Polar benefit
// descriptions, in Polar's order. Polar is the SSOT for features; only MINDS is computed. board 0052/0055.
function featuresFor(tierId: string, fallbackEur: number): string[] {
	const eur = billing?.prices?.[tierId] ?? fallbackEur
	const minds = `${weeklyMindsLabel(eur)} / week of private AI`
	return [minds, ...(billing?.benefits?.[tierId] ?? [])]
}

// Writes go through TanStack mutations that invalidate billing + usage on success (the SSE
// stream covers it too, but the explicit invalidate makes the UI snap immediately). board 0055.
function invalidateBilling(): void {
	void queryClient.invalidateQueries({ queryKey: ['billing'] })
	void queryClient.invalidateQueries({ queryKey: ['usage'] })
}
function setErr(e: unknown): void {
	error = e instanceof Error ? e.message : String(e)
}
const cancelMut = createMutation(() => ({
	mutationFn: () => cancelSubscription('period_end'),
	onSuccess: () => {
		confirmCancel = false
		invalidateBilling()
	},
	onError: setErr
}))
const resumeMut = createMutation(() => ({
	mutationFn: () => uncancelSubscription(),
	onSuccess: invalidateBilling,
	onError: setErr
}))
const switchMut = createMutation(() => ({
	mutationFn: (tierId: string) => switchSubscription(tierId),
	onSuccess: invalidateBilling,
	onError: setErr
}))
const manageBusy = $derived(
	bookBusy || cancelMut.isPending || resumeMut.isPending || switchMut.isPending
)

async function book(tierId: string): Promise<void> {
	if (manageBusy) return
	bookBusy = true
	error = null
	try {
		await startCheckout(tierId) // redirects away on success
	} catch (e) {
		setErr(e)
		bookBusy = false
	}
}

function switchTo(tierId: string): void {
	if (manageBusy) return
	error = null
	switchMut.mutate(tierId)
}

function doCancel(): void {
	if (manageBusy) return
	error = null
	cancelMut.mutate()
}

function doResume(): void {
	if (manageBusy) return
	error = null
	resumeMut.mutate()
}

// Format cents → localized currency; ISO → localized date.
function fmtMoney(cents: number, currency: string): string {
	try {
		return new Intl.NumberFormat(getLocale(), {
			style: 'currency',
			currency: currency.toUpperCase()
		}).format(cents / 100)
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
	}
}
function fmtDate(iso: string | null): string {
	if (!iso) return ''
	try {
		return new Date(iso).toLocaleDateString(getLocale(), {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		})
	} catch {
		return iso
	}
}
// Translate a known status/interval/reason, falling back to the humanized raw value.
function label(group: 'status' | 'interval' | 'reason', raw: string): string {
	const key = `mainnet.pricing.${group}.${raw}`
	const v = t(key)
	return v === key ? raw.replace(/_/g, ' ') : v
}
const isActive = (s: BillingSubscription): boolean =>
	s.status === 'active' || s.status === 'trialing'
// Only show CURRENT subscriptions in the list (drops canceled/legacy history).
const activeSubs = $derived(billing?.subscriptions.filter(isActive) ?? [])

// Open an order's invoice (generated + proxied server-side) in the in-app PDF modal.
async function openInvoice(orderId: string): Promise<void> {
	if (invoiceBusyId) return
	invoiceBusyId = orderId
	error = null
	const url = await fetchInvoiceBlobUrl(orderId)
	invoiceBusyId = null
	if (url) invoiceUrl = url
	else error = 'invoice_unavailable'
}
function closeInvoice(): void {
	if (invoiceUrl) URL.revokeObjectURL(invoiceUrl)
	invoiceUrl = null
}
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
	<div class="mx-auto flex w-full max-w-4xl flex-col">
		{#if error}
			<p class="text-destructive mb-3 text-center text-sm">
				{t('mainnet.pricing.error', { message: error })}
			</p>
		{/if}

		{#if section === 'plans'}
			<div class="mb-1 text-center">
				<h2 class="font-display text-foreground text-xl font-medium tracking-tight">
					{t('mainnet.pricing.title')}
				</h2>
				<p class="text-muted-foreground mx-auto mt-1 max-w-lg text-sm leading-relaxed">
					{t('mainnet.pricing.subtitle')}
				</p>
			</div>

			<div class="mt-5 grid gap-4 sm:grid-cols-3">
				{#each TIER_LIST as tier (tier.id)}
					{@const act = actionFor(tier.id)}
					<div
						class="relative flex flex-col rounded-[var(--radius-lg)] p-5 {act === 'current'
							? 'border-primary/40 bg-card border-2'
							: 'border-border bg-card border'}"
					>
						{#if act === 'current'}
							<span
								class="bg-primary text-primary-foreground absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-bold whitespace-nowrap tracking-wider uppercase shadow-sm"
							>
								{t('mainnet.pricing.currentPlan')}
							</span>
						{/if}
						<h3 class="text-foreground text-base font-semibold">
							{t(`mainnet.pricing.tiers.${tier.id}.name`)}
						</h3>
						<p class="text-muted-foreground mt-0.5 text-xs">
							{t(`mainnet.pricing.tiers.${tier.id}.tagline`)}
						</p>
						<div class="mt-3 flex items-baseline gap-1">
							<span class="text-foreground text-2xl font-semibold tracking-tight"
								>{priceLabel(tier.id, tier.eur)}</span
							>
							<span class="text-muted-foreground text-sm">{t('mainnet.pricing.perWeek')}</span>
						</div>
						<p class="text-muted-foreground mt-0.5 text-[11px]">{t('mainnet.pricing.exclVat')}</p>
						<ul class="text-foreground/90 mt-4 flex flex-col gap-2 text-sm">
							{#each featuresFor(tier.id, tier.eur) as f (f)}
								<li class="flex gap-2">
									<span class="text-primary" aria-hidden="true">✓</span>
									{f}
								</li>
							{/each}
						</ul>
						<div class="flex-1"></div>

						{#if act === 'current'}
							<div
								class="border-border text-muted-foreground mt-5 rounded-full border px-4 py-2.5 text-center text-sm font-medium"
							>
								{t('mainnet.pricing.currentPlan')}
							</div>
						{:else}
							<button
								type="button"
								class="mt-5 inline-flex w-full items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 {act ===
								'downgrade'
									? 'border-border text-foreground hover:bg-card border'
									: 'bg-primary text-primary-foreground hover:bg-primary/90'}"
								onclick={() => void (act === 'book' ? book(tier.id) : switchTo(tier.id))}
								disabled={manageBusy}
							>
								{#if manageBusy}
									{t('mainnet.pricing.working')}
								{:else if act === 'book'}
									{t('mainnet.pricing.bookTier', { tier: t(`mainnet.pricing.tiers.${tier.id}.name`) })}
								{:else if act === 'upgrade'}
									{t('mainnet.pricing.upgradeTo', {
										tier: t(`mainnet.pricing.tiers.${tier.id}.name`)
									})}
								{:else}
									{t('mainnet.pricing.downgradeTo', {
										tier: t(`mainnet.pricing.tiers.${tier.id}.name`)
									})}
								{/if}
							</button>
						{/if}
					</div>
				{/each}
			</div>

			<p
				class="text-muted-foreground mx-auto mt-5 max-w-lg text-center text-[11px] leading-relaxed"
			>
				{t('mainnet.pricing.footnote')}
			</p>
		{:else}
			<div class="mb-1">
				<h2 class="font-display text-foreground text-xl font-medium tracking-tight">
					{t('mainnet.pricing.manageTitle')}
				</h2>
				<p class="text-muted-foreground mt-1 max-w-lg text-sm leading-relaxed">
					{t('mainnet.pricing.manageSubtitle')}
				</p>
			</div>

			<!-- Subscriptions, skills & orders — entirely in our own UI -->
			{#if billing && (activeSubs.length > 0 || billing.orders.length > 0)}
				<div class="mt-6">
					{#if activeSubs.length > 0}
						<p class="text-muted-foreground mt-3 text-[10px] font-bold tracking-wider uppercase">
							{t('mainnet.pricing.subscriptions')}
						</p>
						<div
							class="border-border divide-border/60 mt-2 divide-y overflow-hidden rounded-[var(--radius-lg)] border"
						>
							{#each activeSubs as s (s.id)}
								<div class="flex items-center justify-between gap-3 px-3 py-2.5">
									<div class="min-w-0">
										<div class="text-foreground text-sm font-medium">
											{s.tier ? t(`mainnet.pricing.tiers.${s.tier}.name`) : s.productId.slice(0, 8)}
										</div>
										<div class="text-muted-foreground mt-0.5 text-xs">
											{fmtMoney(s.amount, s.currency)}
											/ {label('interval', s.recurringInterval)}
											·
											{s.cancelAtPeriodEnd
												? t('mainnet.pricing.cancelsOn', {
														date: fmtDate(s.endsAt ?? s.currentPeriodEnd)
													})
												: t('mainnet.pricing.renewsOn', { date: fmtDate(s.currentPeriodEnd) })}
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-2">
										<!-- Manage actions on the subscription row itself -->
										{#if isActive(s)}
											{#if s.cancelAtPeriodEnd}
												<button
													type="button"
													class="text-primary text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50"
													onclick={() => void doResume()}
													disabled={manageBusy}
												>
													{t('mainnet.pricing.resume')}
												</button>
											{:else if confirmCancel}
												<button
													type="button"
													class="text-destructive text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50"
													onclick={() => void doCancel()}
													disabled={manageBusy}
												>
													{t('mainnet.pricing.cancelYes')}
												</button>
												<button
													type="button"
													class="text-muted-foreground hover:text-foreground text-xs font-semibold"
													onclick={() => (confirmCancel = false)}
													disabled={manageBusy}
												>
													{t('mainnet.pricing.keep')}
												</button>
											{:else}
												<button
													type="button"
													class="text-muted-foreground hover:text-foreground text-xs font-semibold underline-offset-2 hover:underline"
													onclick={() => (confirmCancel = true)}
												>
													{t('mainnet.pricing.cancel')}
												</button>
											{/if}
										{/if}
										<span
											class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {isActive(
												s
											)
												? 'bg-primary/15 text-primary'
												: 'bg-muted text-muted-foreground'}"
										>
											{label('status', s.status)}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if billing.skills.length > 0}
						<p class="text-muted-foreground mt-4 text-[10px] font-bold tracking-wider uppercase">
							{t('mainnet.pricing.skills')}
						</p>
						<div class="mt-2 flex flex-wrap gap-2">
							{#each billing.skills as sk (sk)}
								<span
									class="bg-primary/15 text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
								>
									<span aria-hidden="true">✦</span>
									{t(`mainnet.pricing.skill.${sk}`) === `mainnet.pricing.skill.${sk}`
										? sk
										: t(`mainnet.pricing.skill.${sk}`)}
								</span>
							{/each}
						</div>
					{/if}

					{#if billing.orders.length > 0}
						<p class="text-muted-foreground mt-4 text-[10px] font-bold tracking-wider uppercase">
							{t('mainnet.pricing.orders')}
						</p>
						<div
							class="border-border divide-border/60 mt-2 divide-y overflow-hidden rounded-[var(--radius-lg)] border"
						>
							{#each billing.orders as o (o.id)}
								<div class="flex items-center justify-between gap-3 px-3 py-2.5">
									<div class="min-w-0">
										<div class="text-foreground text-sm font-medium">
											{fmtMoney(o.amount, o.currency)}
										</div>
										<div class="text-muted-foreground mt-0.5 text-xs">
											{fmtDate(o.createdAt)}
											· {label('reason', o.billingReason)}
										</div>
									</div>
									<div class="flex shrink-0 items-center gap-2">
										{#if o.paid}
											<button
												type="button"
												class="text-muted-foreground hover:text-foreground text-xs font-semibold underline-offset-2 hover:underline disabled:opacity-50"
												onclick={() => void openInvoice(o.id)}
												disabled={invoiceBusyId !== null}
											>
												{invoiceBusyId === o.id
													? t('mainnet.pricing.working')
													: t('mainnet.pricing.invoice')}
											</button>
										{/if}
										<span
											class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {o.paid
												? 'bg-primary/15 text-primary'
												: 'bg-muted text-muted-foreground'}"
										>
											{label('status', o.status)}
										</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else}
				<p class="text-muted-foreground mt-6 text-center text-[13px] leading-relaxed">
					{t('mainnet.pricing.manageEmpty')}
				</p>
			{/if}
		{/if}
	</div>
</div>

<!-- Invoice preview modal — PDF rendered from a blob: URL (CSP-safe), with a Download button.
     (Inline PDF rendering in the Tauri WKWebView can be blank; Download always works.) -->
{#if section === 'billing' && invoiceUrl}
	<div
		class="bg-background/95 fixed inset-0 z-50 flex flex-col p-4 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
	>
		<div class="mx-auto flex w-full max-w-3xl items-center justify-between pb-3">
			<h3 class="font-display text-foreground text-base font-medium">
				{t('mainnet.pricing.invoiceTitle')}
			</h3>
			<div class="flex items-center gap-2">
				<a
					href={invoiceUrl}
					download="invoice.pdf"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-4 py-1.5 text-xs font-semibold transition-colors"
				>
					{t('mainnet.pricing.download')}
				</a>
				<button
					type="button"
					class="border-border hover:bg-card rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors"
					onclick={closeInvoice}
				>
					{t('mainnet.pricing.close')}
				</button>
			</div>
		</div>
		<iframe
			src={invoiceUrl}
			title={t('mainnet.pricing.invoiceTitle')}
			class="border-border bg-card mx-auto w-full max-w-3xl flex-1 rounded-[var(--radius-lg)] border"
		></iframe>
	</div>
{/if}
