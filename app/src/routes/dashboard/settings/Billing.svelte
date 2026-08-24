<script lang="ts">
import { euro, PLANS, type Plan } from '@avenos/aven-brand/pricing'
import { PolarEmbedCheckout } from '@polar-sh/checkout/embed'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onDestroy, onMount } from 'svelte'
import { page } from '$app/state'

/**
 * Abrechnung — the member's whole Polar relationship, entirely in our brand.
 *
 * Nothing here leaves the pane: the checkout runs INLINE (Polar's embedded
 * checkout overlays this view), orders are the provider's real orders, and
 * the subscription lifecycle — book, pause, resume, cancel — is all native.
 * Polar is the merchant of record; each paid order's official invoice PDF
 * is fetched per order and opened in a dedicated avenOS window.
 *
 * Everything routes through the id service with the session token (the
 * Polar key never reaches this binary), and every call acts on the
 * session's OWN records — the pane never handles a customer, subscription
 * or checkout id. The webhook is the only writer of state: after an action
 * the pane shows a pending note and polls until the event lands.
 *
 * avenME and avenFOUNDER are INDEPENDENT products — one per human, one per
 * company. Both can stand at once; each is booked and canceled on its own,
 * and there is no cross-tier change of any kind. avenID is a one-off the
 * funnel owns; avenCOOP is not a Polar product — handled individually.
 */

interface Standing {
	tier: string
	status: string
	priceEurCents: number
	currentPeriodEnd: string | null
	cancelAtPeriodEnd: boolean
}

interface Order {
	id: string
	createdAt: string
	productId: string
	tier: string | null
	subTotalCents: number
	taxCents: number
	discountCents: number
	amountPaidCents: number
	currency: string
	status: string
	invoiceGenerated: boolean
}

const TIER_PLANS: Plan[] = PLANS.filter((p) => p.id === 'avenme' || p.id === 'avenceo')
/** A subscription in one of these states is over — the tier is bookable
 * again. Mirrors the server's ENDED_STATUSES, Polar vocabulary. */
const ENDED = ['canceled', 'expired', 'incomplete_expired', 'unpaid', 'revoked']
/** If the embed hasn't reported `loaded`, this is how long we wait before
 * falling back to the dedicated in-app window. */
const EMBED_READY_TIMEOUT_MS = 8000

let subscriptions = $state<Standing[]>([])
let orders = $state<Order[]>([])
let loading = $state(true)
let busy = $state('')
let pending = $state('')
let failure = $state<string | null>(null)
/** Which action is asking "wirklich?" — one confirm at a time. */
let confirming = $state<`cancel:${string}` | `pause:${string}` | null>(null)
/** Which order row is expanded into its in-app rendered detail. */
let openOrder = $state<string | null>(null)
/** The inline checkout, when one is running (the embed overlays the pane). */
let checkout = $state<{ tier: string } | null>(null)
/** The live embed instance — set once Polar reports `loaded`. */
let embed: PolarEmbedCheckout | null = null
let pollTimer: ReturnType<typeof setInterval> | undefined
let embedTimer: ReturnType<typeof setTimeout> | undefined

// In the browser the pane renders from fixtures so every state is stylable
// without a paid account: ?billing=none|active|paused|cancel|checkout|both.
const fixtureScenario = $derived(page.url.searchParams.get('billing') ?? 'active')

function fixtures(scenario: string): { subscriptions: Standing[]; orders: Order[] } {
	const paidOrders: Order[] = [
		{
			id: 'ord_demo_2',
			createdAt: '2026-08-14T09:12:00.000Z',
			productId: 'prod_6ALajlETScD2v0dv10n618',
			tier: 'avenme',
			subTotalCents: 4200,
			taxCents: 798,
			discountCents: 0,
			amountPaidCents: 4998,
			currency: 'EUR',
			status: 'paid',
			invoiceGenerated: true
		},
		{
			id: 'ord_demo_1',
			createdAt: '2026-07-02T15:40:00.000Z',
			productId: 'prod_3FJqTxDvcsUaj4YPo7lfDm',
			tier: 'avenid',
			subTotalCents: 2500,
			taxCents: 475,
			discountCents: 0,
			amountPaidCents: 2975,
			currency: 'EUR',
			status: 'paid',
			invoiceGenerated: false
		}
	]
	const me: Standing = {
		tier: 'avenme',
		status: scenario === 'paused' ? 'paused' : 'active',
		priceEurCents: 4200,
		currentPeriodEnd: '2026-09-14T09:12:00.000Z',
		cancelAtPeriodEnd: scenario === 'cancel'
	}
	const founder: Standing = {
		tier: 'avenceo',
		status: 'active',
		priceEurCents: 37700,
		currentPeriodEnd: '2026-09-14T09:12:00.000Z',
		cancelAtPeriodEnd: false
	}
	if (scenario === 'none') return { subscriptions: [], orders: [] }
	if (scenario === 'checkout') return { subscriptions: [], orders: paidOrders.slice(1) }
	if (scenario === 'both') return { subscriptions: [me, founder], orders: paidOrders }
	return { subscriptions: [me], orders: paidOrders }
}

/** The plan an order bought — matched by the SSOT tier the server reads
 * from the product's metadata. */
function planOfOrder(order: Order): Plan | null {
	return PLANS.find((p) => p.id === order.tier) ?? null
}

async function refresh() {
	if (!isTauri()) {
		const fixture = fixtures(fixtureScenario)
		subscriptions = fixture.subscriptions
		orders = fixture.orders
		if (fixtureScenario === 'checkout' && !checkout) checkout = { tier: 'avenme' }
		return
	}
	// Defensive against foreign shapes (an older server, an error body): a
	// missing array must degrade to "nothing", never crash the pane.
	const me = await invoke<{ subscriptions?: Standing[] }>('billing_me')
	subscriptions = Array.isArray(me?.subscriptions) ? me.subscriptions : []
	// Orders exist without a subscription — the one-off avenID is an order
	// too, resolved via the session's own email.
	const history = await invoke<{ orders?: Order[] }>('billing_orders')
	orders = Array.isArray(history?.orders) ? history.orders : []
}

/** After an action: watch for the webhook to land, then stop announcing.
 * While a checkout runs, the checkout status is polled alongside — the
 * webhook stays the only state writer, the poll only reads. */
function watch(until: (subs: Standing[]) => boolean, note: string) {
	pending = note
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = setInterval(async () => {
		try {
			await refresh()
			if (checkout && isTauri()) {
				const latest = await invoke<{ checkout: { status: string } | null }>('billing_checkout')
				const status = latest.checkout?.status
				if (status === 'failed' || status === 'expired') {
					failure =
						status === 'failed'
							? 'Die Zahlung ist fehlgeschlagen — bitte versuche es noch einmal.'
							: 'Der Checkout ist abgelaufen — bitte starte ihn neu.'
					pending = ''
					closeCheckout()
					if (pollTimer) clearInterval(pollTimer)
					return
				}
			}
			if (until(subscriptions)) {
				pending = ''
				closeCheckout()
				if (pollTimer) clearInterval(pollTimer)
			}
		} catch {
			// keep polling; transient failures resolve themselves
		}
	}, 5000)
}

async function act(label: string, run: () => Promise<void>) {
	busy = label
	failure = null
	confirming = null
	try {
		await run()
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
		pending = ''
	} finally {
		busy = ''
	}
}

function standingOf(subs: Standing[], tier: string): Standing | null {
	return subs.find((s) => s.tier === tier) ?? null
}

/** Start a checkout INLINE: Polar's embedded checkout overlays the pane and
 * reports back through its own message channel. The url came from the id
 * service; the pane never builds one. */
async function subscribe(tier: string) {
	await act(`subscribe:${tier}`, async () => {
		const result = await invoke<{ checkoutUrl: string }>('billing_subscribe', {
			tier,
			// Our own origin, so Polar accepts this page as the embedding frame.
			embedOrigin: window.location.origin
		})
		checkout = { tier }
		armEmbedFallback(result.checkoutUrl)
		void openEmbed(result.checkoutUrl)
		watch((subs) => {
			const s = standingOf(subs, tier)
			return s !== null && !ENDED.includes(s.status)
		}, 'Sobald die Zahlung bestätigt ist, erscheint dein Plan hier.')
	})
}

async function openEmbed(url: string) {
	try {
		const theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
		// Resolves only once Polar reports `loaded` — until then the armed
		// fallback below owns the timeout.
		const instance = await PolarEmbedCheckout.create(url, { theme })
		embed = instance
		if (embedTimer) clearTimeout(embedTimer)
		instance.addEventListener('confirmed', () => {
			pending = 'Zahlung bestätigt — dein Plan erscheint gleich.'
		})
		instance.addEventListener('success', (event) => {
			// Never let the embed redirect the app; the poll is the truth.
			event.preventDefault()
			pending = 'Zahlung bestätigt — dein Plan erscheint gleich.'
		})
		instance.addEventListener('close', () => {
			embed = null
			checkout = null
		})
	} catch {
		// The embed could not mount at all — the armed fallback takes over.
	}
}

function armEmbedFallback(url: string) {
	if (embedTimer) clearTimeout(embedTimer)
	embedTimer = setTimeout(async () => {
		// No `loaded` from the embed: the provider refused the frame (or the
		// network is slow). Same checkout, dedicated avenOS window — never
		// the system browser. Polling keeps running either way.
		if (checkout && !embed && isTauri()) {
			sweepEmbedDom()
			try {
				await invoke('billing_checkout_window', { url })
				pending =
					'Der Checkout läuft in einem eigenen avenOS‑Fenster weiter — dein Plan erscheint hier, sobald die Zahlung bestätigt ist.'
			} catch (cause) {
				failure = cause instanceof Error ? cause.message : String(cause)
			}
		}
	}, EMBED_READY_TIMEOUT_MS)
}

/** The embed injects its iframe and spinner before it ever loads; if we bail
 * out earlier than `loaded`, that DOM is still ours to sweep up. */
function sweepEmbedDom() {
	for (const frame of document.querySelectorAll('iframe[src*="embed=true"]')) frame.remove()
	document.querySelector('.polar-loader-spinner')?.parentElement?.remove()
	document.body.classList.remove('polar-no-scroll')
}

function closeCheckout() {
	if (embedTimer) clearTimeout(embedTimer)
	embed?.close()
	embed = null
	sweepEmbedDom()
	checkout = null
}

async function cancel(tier: string) {
	await act(`cancel:${tier}`, async () => {
		await invoke('billing_cancel', { tier, immediate: false })
		watch((subs) => {
			const s = standingOf(subs, tier)
			return s?.cancelAtPeriodEnd === true || ENDED.includes(s?.status ?? '')
		}, 'Kündigung angestoßen — gleich steht hier dein Enddatum.')
	})
}

async function pause(tier: string) {
	await act(`pause:${tier}`, async () => {
		await invoke('billing_pause', { tier })
		watch(
			(subs) => standingOf(subs, tier)?.status === 'paused',
			'Pause angestoßen — dein Plan ruht gleich.'
		)
	})
}

/** Fortsetzen — lifts a pause, or reverts a scheduled cancellation. */
async function resume(tier: string) {
	await act(`resume:${tier}`, async () => {
		await invoke('billing_resume', { tier })
		watch((subs) => {
			const s = standingOf(subs, tier)
			return s?.status === 'active' && s.cancelAtPeriodEnd === false
		}, 'Fortsetzung angestoßen — dein Plan läuft gleich wieder.')
	})
}

/** The official invoice PDF for one paid order: the id service asks Polar
 * (generating the document on first ask — that can take a few seconds),
 * then the PDF opens in a dedicated avenOS window. */
async function downloadInvoice(orderId: string) {
	if (!isTauri()) return
	await act(`invoice:${orderId}`, async () => {
		const result = await invoke<{ url: string }>('billing_invoice_url', { orderId })
		await invoke('billing_invoice_window', { url: result.url })
	})
}

const cents = (value: number) => (value / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })

const dateOf = (iso: string) =>
	new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

/** Polar's subscription vocabulary, in our words. */
const STATUS_LABEL: Record<string, string> = {
	active: 'Aktiv',
	trialing: 'Testphase',
	paused: 'Pausiert',
	past_due: 'Zahlung überfällig',
	canceled: 'Gekündigt',
	unpaid: 'Unbezahlt',
	incomplete: 'In Bearbeitung',
	incomplete_expired: 'Abgelaufen',
	expired: 'Abgelaufen',
	revoked: 'Beendet'
}

const ORDER_STATUS: Record<string, string> = {
	paid: 'Bezahlt',
	pending: 'Ausstehend',
	refunded: 'Erstattet',
	partially_refunded: 'Teilweise erstattet'
}

onMount(async () => {
	try {
		await refresh()
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})

onDestroy(() => {
	if (pollTimer) clearInterval(pollTimer)
	if (embedTimer) clearTimeout(embedTimer)
	embed?.close()
	embed = null
	sweepEmbedDom()
})
</script>

{#snippet planCard(p: Plan)}
	{@const s = standingOf(subscriptions, p.id)}
	{@const isLive = s !== null && !ENDED.includes(s.status)}
	<article
		class="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {isLive
			? 'border-primary bg-surface-raised'
			: 'border-foreground/5 bg-surface-raised'}"
	>
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-sm font-medium">{p.name}</h3>
			{#if isLive && s}
				<span
					class="rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.12em] {s.cancelAtPeriodEnd ||
					['paused', 'past_due', 'unpaid', 'incomplete'].includes(s.status)
						? 'bg-warning/15 text-warning-strong'
						: 'bg-success/15 text-success-strong'}"
				>
					{s.cancelAtPeriodEnd ? 'Endet bald' : (STATUS_LABEL[s.status] ?? s.status)}
				</span>
			{/if}
		</div>
		<p class="text-xs opacity-60">{p.role}</p>
		<p class="text-lg font-semibold">
			{isLive && s ? cents(s.priceEurCents) : euro(p.eurPrice)}
			€<span class="pl-1 text-xs font-normal opacity-50">/Monat · zzgl. USt.</span>
		</p>
		<ul class="flex flex-col gap-1 text-xs opacity-70">
			{#each p.features.slice(0, 5) as feature, index (index)}
				<li class="flex gap-2">
					<span class="opacity-50">·</span>
					<span>{typeof feature === 'string' ? feature : feature.label}</span>
				</li>
			{/each}
		</ul>
		{#if isLive && s}
			{#if s.status === 'paused'}
				<p class="text-xs opacity-60">Pausiert — es wird nichts abgebucht, bis du fortsetzt.</p>
			{:else if s.currentPeriodEnd}
				<p class="text-xs opacity-60">
					{s.cancelAtPeriodEnd
						? `Endet am ${dateOf(s.currentPeriodEnd)} — bis dahin läuft alles weiter.`
						: `Verlängert sich am ${dateOf(s.currentPeriodEnd)}.`}
				</p>
			{/if}
		{/if}
		<!-- Buchen / Pausieren / Kündigen / Fortsetzen — each product entirely
		     on its own; both can stand at once. -->
		<div class="mt-auto pt-2">
			{#if !isLive}
				<button
					type="button"
					onclick={() => subscribe(p.id)}
					disabled={busy !== ''}
					class="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					{busy === `subscribe:${p.id}` ? 'Einen Moment …' : 'Jetzt buchen'}
				</button>
			{:else if s && (s.cancelAtPeriodEnd || s.status === 'paused')}
				<button
					type="button"
					onclick={() => resume(p.id)}
					disabled={busy !== ''}
					class="w-full rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
				>
					{busy === `resume:${p.id}` ? 'Einen Moment …' : 'Fortsetzen'}
				</button>
			{:else if confirming === `pause:${p.id}`}
				<div class="flex flex-col gap-2">
					<p class="text-xs opacity-70">
						Dein Plan ruht: keine Abbuchung, kein Zugang — und jederzeit mit einem Klick wieder da.
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => pause(p.id)}
							disabled={busy !== ''}
							class="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
						>
							{busy === `pause:${p.id}` ? 'Einen Moment …' : 'Pause bestätigen'}
						</button>
						<button
							type="button"
							onclick={() => (confirming = null)}
							class="rounded-full border border-border px-4 py-2 text-sm"
						>
							Abbrechen
						</button>
					</div>
				</div>
			{:else if confirming === `cancel:${p.id}`}
				<div class="flex flex-col gap-2">
					<p class="text-xs opacity-70">
						Dein Plan endet zum Ablauf des bezahlten Zeitraums{s?.currentPeriodEnd
							? ` am ${dateOf(s.currentPeriodEnd)}`
							: ''}. Bis dahin ändert sich nichts.
					</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() => cancel(p.id)}
							disabled={busy !== ''}
							class="rounded-full bg-error px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
						>
							{busy === `cancel:${p.id}` ? 'Einen Moment …' : 'Kündigung bestätigen'}
						</button>
						<button
							type="button"
							onclick={() => (confirming = null)}
							class="rounded-full border border-border px-4 py-2 text-sm"
						>
							Abbrechen
						</button>
					</div>
				</div>
			{:else}
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						onclick={() => (confirming = `pause:${p.id}`)}
						disabled={busy !== ''}
						class="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
					>
						Pausieren
					</button>
					<button
						type="button"
						onclick={() => (confirming = `cancel:${p.id}`)}
						disabled={busy !== ''}
						class="rounded-full border border-border px-4 py-2 text-sm font-medium opacity-70 transition-colors hover:bg-error/5 hover:opacity-100 disabled:opacity-40"
					>
						Kündigen
					</button>
				</div>
			{/if}
		</div>
	</article>
{/snippet}

<section class="flex flex-col gap-4">
	<h2 class="text-sm">Abrechnung</h2>

	{#if loading}
		<p
			class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			Deine Abrechnung wird geladen …
		</p>
	{:else}
		{#if pending}
			<p
				class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				{pending}
			</p>
		{/if}

		{#if checkout}
			<!-- Inline checkout: Polar's embed overlays the pane; this card is
			     what remains visible behind it and after a fallback. -->
			<div
				class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-baseline justify-between gap-2">
					<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">
						Checkout · {TIER_PLANS.find((p) => p.id === checkout?.tier)?.name ?? checkout.tier}
					</p>
					<button
						type="button"
						onclick={closeCheckout}
						class="text-xs opacity-50 transition-opacity hover:opacity-100"
					>
						Abbrechen
					</button>
				</div>
				<p class="text-xs opacity-60">
					Sobald die Zahlung bestätigt ist, erscheint dein Plan hier.
				</p>
				<p class="text-[0.6875rem] opacity-40">
					Sichere Zahlung über Polar, unseren Zahlungsabwickler. Die offizielle Rechnung findest du
					anschließend unter „Meine Bestellungen“.
				</p>
			</div>
		{/if}

		<!-- Zwei unabhängige Produkte, aus demselben SSOT wie die Website —
		     settings und Website können sich beim Preis nicht widersprechen. -->
		<div class="flex flex-col gap-2">
			<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Deine Produkte</p>
			<div class="flex flex-col gap-3 sm:flex-row">
				{#each TIER_PLANS as p (p.id)}
					{@render planCard(p)}
				{/each}
			</div>
		</div>

		<!-- Meine Bestellungen: each order expands into its in-app detail from
		     real order data; the official Polar invoice PDF is one click away. -->
		<div class="flex flex-col gap-2">
			<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Meine Bestellungen</p>
			{#if orders.length}
				<ul
					class="flex flex-col divide-y divide-foreground/5 rounded-xl border border-foreground/5 bg-surface-raised shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					{#each orders as order (order.id)}
						{@const plan = planOfOrder(order)}
						<li class="flex flex-col">
							<button
								type="button"
								onclick={() => (openOrder = openOrder === order.id ? null : order.id)}
								class="flex items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-primary/5"
							>
								<span class="opacity-60">{dateOf(order.createdAt)}</span>
								<span class="flex-1 font-medium">{plan?.name ?? 'Bestellung'}</span>
								<span class="font-medium">
									{cents(order.amountPaidCents)}
									{order.currency === 'EUR' ? '€' : order.currency}
								</span>
								<span class="opacity-50">{ORDER_STATUS[order.status] ?? order.status}</span>
								<span class="opacity-30">{openOrder === order.id ? '▴' : '▾'}</span>
							</button>
							{#if openOrder === order.id}
								<div
									class="flex flex-col gap-1.5 border-t border-foreground/5 bg-primary/[0.02] px-4 py-3 text-xs"
								>
									<div class="flex justify-between gap-4">
										<span class="opacity-40">Netto</span>
										<span>{cents(order.subTotalCents)} €</span>
									</div>
									{#if order.discountCents > 0}
										<div class="flex justify-between gap-4">
											<span class="opacity-40">Rabatt</span>
											<span>−{cents(order.discountCents)} €</span>
										</div>
									{/if}
									<div class="flex justify-between gap-4">
										<span class="opacity-40">USt.</span>
										<span>{cents(order.taxCents)} €</span>
									</div>
									<div class="flex justify-between gap-4 font-medium">
										<span class="opacity-40">Bezahlt</span>
										<span>{cents(order.amountPaidCents)} €</span>
									</div>
									<div class="flex justify-between gap-4">
										<span class="opacity-40">Bestell‑Nr.</span>
										<span class="font-mono opacity-60">{order.id}</span>
									</div>
									{#if order.status === 'paid'}
										<div class="pt-1">
											<button
												type="button"
												onclick={() => downloadInvoice(order.id)}
												disabled={busy !== ''}
												class="rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
											>
												{busy === `invoice:${order.id}`
													? 'Rechnung wird erstellt …'
													: 'Rechnung herunterladen'}
											</button>
										</div>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p
					class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-50 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
				>
					Noch keine Bestellungen — sobald du etwas buchst, steht sie hier.
				</p>
			{/if}
		</div>
	{/if}

	{#if failure}
		<p class="rounded-xl border border-error/30 bg-error-muted px-4 py-3 text-xs text-error-strong">
			{failure}
		</p>
	{/if}
</section>
