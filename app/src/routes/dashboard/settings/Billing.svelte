<script lang="ts">
import { euro, PLANS, type Plan } from '@avenos/aven-website/pricing'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { onDestroy, onMount } from 'svelte'
import { page } from '$app/state'

/**
 * Abrechnung — the member's whole Creem relationship, entirely in our brand.
 *
 * Nothing here leaves the pane: the checkout runs INLINE (the same
 * creem-embed iframe protocol the website's checkout uses), orders are the
 * provider's real orders, and the subscription lifecycle — change, pause,
 * resume, cancel — is all native. The only mention of Creem is the line
 * telling you where your official invoice went: Creem, as merchant of
 * record, mails it at purchase; its API carries no document, so we say so
 * instead of linking out.
 *
 * Everything routes through the id service with the session token (the
 * Creem key never reaches this binary), and every call acts on the
 * session's OWN records — the pane never handles a customer, subscription
 * or checkout id. The webhook is the only writer of state: after an action
 * the pane shows a pending note and polls until the event lands.
 *
 * The ladder is avenME and avenCEO. avenID is a one-off the funnel owns;
 * avenCOOP is not a Creem product — handled individually.
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
	subTotalCents: number
	taxCents: number
	discountCents: number
	amountPaidCents: number
	currency: string
	status: string
}

const TIER_PLANS: Plan[] = PLANS.filter((p) => p.id === 'avenme' || p.id === 'avenceo')
const ENDED = ['canceled', 'expired']
/** Origins the inline embed may speak from — the website's list, verbatim. */
const CREEM_ORIGINS = new Set([
	'https://creem.io',
	'https://checkout.creem.io',
	'https://www.creem.io'
])
/** If the provider refuses to be framed, this is how long we wait for its
 * `ready` before falling back to the dedicated in-app window. */
const EMBED_READY_TIMEOUT_MS = 8000

let standing = $state<Standing | null>(null)
let orders = $state<Order[]>([])
let loading = $state(true)
let busy = $state('')
let pending = $state('')
let failure = $state<string | null>(null)
/** Which action is asking "wirklich?" — one confirm at a time. */
let confirming = $state<'cancel' | 'pause' | `change:${string}` | null>(null)
/** Which order row is expanded into its in-app rendered detail. */
let openOrder = $state<string | null>(null)
/** The inline checkout, when one is running. */
let checkout = $state<{ tier: string; url: string; ready: boolean } | null>(null)
let checkoutFrame = $state<HTMLIFrameElement | null>(null)
let pollTimer: ReturnType<typeof setInterval> | undefined
let embedTimer: ReturnType<typeof setTimeout> | undefined

const currentPlan = $derived(TIER_PLANS.find((p) => p.id === standing?.tier) ?? null)
const live = $derived(standing !== null && !ENDED.includes(standing.status))

// In the browser the pane renders from fixtures so every state is stylable
// without a paid account: ?billing=none|active|paused|cancel|checkout.
const fixtureScenario = $derived(page.url.searchParams.get('billing') ?? 'active')

function fixtures(scenario: string): { standing: Standing | null; orders: Order[] } {
	const paidOrders: Order[] = [
		{
			id: 'ord_demo_2',
			createdAt: '2026-08-14T09:12:00.000Z',
			productId: 'prod_6ALajlETScD2v0dv10n618',
			subTotalCents: 4200,
			taxCents: 798,
			discountCents: 0,
			amountPaidCents: 4998,
			currency: 'EUR',
			status: 'paid'
		},
		{
			id: 'ord_demo_1',
			createdAt: '2026-07-02T15:40:00.000Z',
			productId: 'prod_3FJqTxDvcsUaj4YPo7lfDm',
			subTotalCents: 2500,
			taxCents: 475,
			discountCents: 0,
			amountPaidCents: 2975,
			currency: 'EUR',
			status: 'paid'
		}
	]
	if (scenario === 'none') return { standing: null, orders: [] }
	if (scenario === 'checkout') return { standing: null, orders: paidOrders.slice(1) }
	return {
		standing: {
			tier: 'avenme',
			status:
				scenario === 'cancel' ? 'scheduled_cancel' : scenario === 'paused' ? 'paused' : 'active',
			priceEurCents: 4200,
			currentPeriodEnd: '2026-09-14T09:12:00.000Z',
			cancelAtPeriodEnd: scenario === 'cancel'
		},
		orders: paidOrders
	}
}

/** The plan an order bought, matched by its net price — the one number
 * the SSOT and the order share. */
function planOfOrder(order: Order): Plan | null {
	return PLANS.find((p) => Math.round(p.eurPrice * 100) === order.subTotalCents) ?? null
}

async function refresh() {
	if (!isTauri()) {
		const fixture = fixtures(fixtureScenario)
		standing = fixture.standing
		orders = fixture.orders
		if (fixtureScenario === 'checkout' && !checkout)
			checkout = { tier: 'avenme', url: 'about:blank', ready: true }
		return
	}
	const me = await invoke<{ subscription: Standing | null }>('billing_me')
	standing = me.subscription
	// Orders exist without a subscription — the one-off avenID is an order
	// too, resolved via the session's own email.
	const history = await invoke<{ orders: Order[] }>('billing_orders')
	orders = history.orders
}

/** After an action: watch for the webhook to land, then stop announcing. */
function watch(until: (s: Standing | null) => boolean, note: string) {
	pending = note
	if (pollTimer) clearInterval(pollTimer)
	pollTimer = setInterval(async () => {
		try {
			await refresh()
			if (until(standing)) {
				pending = ''
				checkout = null
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

/** Start a checkout INLINE: the pane swaps the pricing cards for the
 * provider's embed and listens for its messages, exactly like the
 * website. The url came from the id service; the pane never builds one. */
async function subscribe(tier: string) {
	await act(`subscribe:${tier}`, async () => {
		const result = await invoke<{ checkoutUrl: string }>('billing_subscribe', { tier })
		checkout = { tier, url: result.checkoutUrl, ready: false }
		armEmbedFallback()
		watch(
			(s) => s !== null && !ENDED.includes(s.status),
			'Sobald die Zahlung bestätigt ist, erscheint dein Plan hier.'
		)
	})
}

function armEmbedFallback() {
	if (embedTimer) clearTimeout(embedTimer)
	embedTimer = setTimeout(async () => {
		// No `ready` from the embed: the provider refused the frame (or the
		// network is slow). Same checkout, dedicated avenOS window — never
		// the system browser. Polling keeps running either way.
		if (checkout && !checkout.ready && isTauri()) {
			try {
				await invoke('billing_checkout_window', { url: checkout.url })
				pending =
					'Der Checkout läuft in einem eigenen avenOS‑Fenster weiter — dein Plan erscheint hier, sobald die Zahlung bestätigt ist.'
			} catch (cause) {
				failure = cause instanceof Error ? cause.message : String(cause)
			}
		}
	}, EMBED_READY_TIMEOUT_MS)
}

function receiveEmbedEvent(event: MessageEvent) {
	if (!CREEM_ORIGINS.has(event.origin) || event.source !== checkoutFrame?.contentWindow) return
	const detail = event.data as { source?: string; type?: string } | null
	if (detail?.source !== 'creem-embed') return
	if (detail.type === 'ready' && checkout) {
		checkout = { ...checkout, ready: true }
		if (embedTimer) clearTimeout(embedTimer)
	}
	if (detail.type === 'completed') {
		pending = 'Zahlung bestätigt — dein Plan erscheint gleich.'
	}
}

function leaveCheckout() {
	checkout = null
	if (embedTimer) clearTimeout(embedTimer)
}

async function changeTo(tier: string) {
	await act(`change:${tier}`, async () => {
		await invoke('billing_upgrade', { tier })
		watch(
			(s) => s?.tier === tier,
			'Planwechsel angestoßen — die Bestätigung kommt in wenigen Momenten.'
		)
	})
}

async function cancel() {
	await act('cancel', async () => {
		await invoke('billing_cancel')
		watch(
			(s) => s?.cancelAtPeriodEnd === true || (s?.status ?? '') === 'canceled',
			'Kündigung angestoßen — gleich steht hier dein Enddatum.'
		)
	})
}

async function pause() {
	await act('pause', async () => {
		await invoke('billing_pause')
		watch((s) => s?.status === 'paused', 'Pause angestoßen — dein Plan ruht gleich.')
	})
}

async function resume() {
	await act('resume', async () => {
		await invoke('billing_resume')
		watch(
			(s) => s?.status === 'active' && s.cancelAtPeriodEnd === false,
			'Fortsetzung angestoßen — dein Plan läuft gleich wieder.'
		)
	})
}

const cents = (value: number) => (value / 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })

const dateOf = (iso: string) =>
	new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })

const STATUS_LABEL: Record<string, string> = {
	active: 'Aktiv',
	trialing: 'Testphase',
	paused: 'Pausiert',
	past_due: 'Zahlung offen',
	canceled: 'Gekündigt',
	expired: 'Abgelaufen',
	scheduled_cancel: 'Endet bald'
}

const ORDER_STATUS: Record<string, string> = {
	paid: 'Bezahlt',
	pending: 'Ausstehend',
	refunded: 'Erstattet',
	partialRefund: 'Teilweise erstattet'
}

onMount(async () => {
	window.addEventListener('message', receiveEmbedEvent)
	try {
		await refresh()
	} catch (cause) {
		failure = cause instanceof Error ? cause.message : String(cause)
	} finally {
		loading = false
	}
})

onDestroy(() => {
	window.removeEventListener('message', receiveEmbedEvent)
	if (pollTimer) clearInterval(pollTimer)
	if (embedTimer) clearTimeout(embedTimer)
})
</script>

{#snippet planCard(p: Plan)}
	{@const isCurrent = standing?.tier === p.id}
	{@const delta = currentPlan ? p.eurPrice - currentPlan.eurPrice : 0}
	<article
		class="flex min-w-0 flex-1 flex-col gap-3 rounded-xl border px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {isCurrent
			? 'border-primary bg-surface-raised'
			: 'border-foreground/5 bg-surface-raised'}"
	>
		<div class="flex items-baseline justify-between gap-2">
			<h3 class="text-sm font-medium">{p.name}</h3>
			{#if isCurrent}
				<span
					class="rounded-full bg-primary/10 px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.12em]"
				>
					Dein Plan
				</span>
			{/if}
		</div>
		<p class="text-xs opacity-60">{p.role}</p>
		<p class="text-lg font-semibold">
			{euro(p.eurPrice)}
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
		<div class="mt-auto pt-2">
			{#if !live}
				<button
					type="button"
					onclick={() => subscribe(p.id)}
					disabled={busy !== ''}
					class="w-full rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
				>
					{busy === `subscribe:${p.id}` ? 'Einen Moment …' : 'Jetzt abonnieren'}
				</button>
			{:else if !isCurrent}
				{#if confirming === `change:${p.id}`}
					<div class="flex flex-col gap-2">
						<p class="text-xs opacity-70">
							{delta > 0
								? 'Die Preisdifferenz wird sofort anteilig berechnet.'
								: 'Der Wechsel gilt ab dem nächsten Abrechnungszeitraum.'}
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								onclick={() => changeTo(p.id)}
								disabled={busy !== ''}
								class="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
							>
								{busy === `change:${p.id}` ? 'Einen Moment …' : 'Wechsel bestätigen'}
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
					<button
						type="button"
						onclick={() => (confirming = `change:${p.id}`)}
						disabled={busy !== ''}
						class="w-full rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
					>
						{delta > 0 ? `Upgrade · +${euro(delta)} €/Monat` : `Wechseln · −${euro(-delta)} €/Monat`}
					</button>
				{/if}
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
		{#if live && standing}
			<!-- Aktueller Plan -->
			<div
				class="flex flex-col gap-2 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">Aktueller Plan</p>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<p class="text-sm font-medium">{currentPlan?.name ?? standing.tier}</p>
					<span
						class="rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.12em] {standing.cancelAtPeriodEnd ||
						standing.status === 'paused'
							? 'bg-warning/15 text-warning-strong'
							: 'bg-success/15 text-success-strong'}"
					>
						{STATUS_LABEL[standing.status] ?? standing.status}
					</span>
				</div>
				<p class="text-xs opacity-60">
					{euro(Math.round(standing.priceEurCents / 100))}
					€ /Monat · zzgl. USt.
				</p>
				{#if standing.status === 'paused'}
					<p class="text-xs opacity-60">Pausiert — es wird nichts abgebucht, bis du fortsetzt.</p>
				{:else if standing.currentPeriodEnd}
					<p class="text-xs opacity-60">
						{standing.cancelAtPeriodEnd
							? `Endet am ${dateOf(standing.currentPeriodEnd)} — bis dahin läuft alles weiter.`
							: `Verlängert sich am ${dateOf(standing.currentPeriodEnd)}.`}
					</p>
				{/if}

				<!-- Pausieren / Kündigen / Fortsetzen: as easy as booking was. -->
				<div class="flex flex-wrap gap-2 pt-1">
					{#if standing.cancelAtPeriodEnd || standing.status === 'paused'}
						<button
							type="button"
							onclick={resume}
							disabled={busy !== ''}
							class="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
						>
							{busy === 'resume' ? 'Einen Moment …' : 'Fortsetzen'}
						</button>
					{:else if confirming === 'pause'}
						<div class="flex w-full flex-col gap-2">
							<p class="text-xs opacity-70">
								Dein Plan ruht: keine Abbuchung, kein Zugang — und jederzeit mit einem Klick wieder
								da.
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={pause}
									disabled={busy !== ''}
									class="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
								>
									{busy === 'pause' ? 'Einen Moment …' : 'Pause bestätigen'}
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
					{:else if confirming === 'cancel'}
						<div class="flex w-full flex-col gap-2">
							<p class="text-xs opacity-70">
								Dein Plan endet zum Ablauf des bezahlten Zeitraums{standing.currentPeriodEnd
									? ` am ${dateOf(standing.currentPeriodEnd)}`
									: ''}. Bis dahin ändert sich nichts.
							</p>
							<div class="flex gap-2">
								<button
									type="button"
									onclick={cancel}
									disabled={busy !== ''}
									class="rounded-full bg-error px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
								>
									{busy === 'cancel' ? 'Einen Moment …' : 'Kündigung bestätigen'}
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
						<button
							type="button"
							onclick={() => (confirming = 'pause')}
							disabled={busy !== ''}
							class="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/5 disabled:opacity-40"
						>
							Pausieren
						</button>
						<button
							type="button"
							onclick={() => (confirming = 'cancel')}
							disabled={busy !== ''}
							class="rounded-full border border-border px-4 py-2 text-sm font-medium opacity-70 transition-colors hover:bg-error/5 hover:opacity-100 disabled:opacity-40"
						>
							Kündigen
						</button>
					{/if}
				</div>
			</div>
		{/if}

		{#if pending}
			<p
				class="rounded-xl border border-foreground/5 bg-surface-raised px-4 py-3 text-xs opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				{pending}
			</p>
		{/if}

		{#if checkout}
			<!-- Inline checkout: the provider's embed inside our card, nothing
			     leaves the pane. -->
			<div
				class="flex flex-col gap-3 rounded-xl border border-foreground/5 bg-surface-raised px-4 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				<div class="flex items-baseline justify-between gap-2">
					<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">
						Checkout · {TIER_PLANS.find((p) => p.id === checkout?.tier)?.name ?? checkout.tier}
					</p>
					<button
						type="button"
						onclick={leaveCheckout}
						class="text-xs opacity-50 transition-opacity hover:opacity-100"
					>
						Abbrechen
					</button>
				</div>
				<div class="relative min-h-[32rem] overflow-hidden rounded-lg border border-foreground/5">
					{#if !checkout.ready}
						<p class="absolute inset-0 flex items-center justify-center text-xs opacity-50">
							Checkout wird geladen …
						</p>
					{/if}
					<iframe
						bind:this={checkoutFrame}
						src={checkout.url}
						title="Checkout"
						allow="payment *; publickey-credentials-get *"
						referrerpolicy="same-origin"
						class="relative h-[32rem] w-full border-0 {checkout.ready ? '' : 'opacity-0'}"
					></iframe>
				</div>
				<p class="text-[0.6875rem] opacity-40">
					Sichere Zahlung über Creem, unseren Zahlungsanbieter. Die offizielle Rechnung bekommst du
					anschließend per E‑Mail.
				</p>
			</div>
		{:else}
			<!-- Plan wählen / ändern: the in-app pricing UI, from the same SSOT the
			     website renders — settings and website cannot disagree on a price. -->
			<div class="flex flex-col gap-2">
				<p class="text-[0.625rem] uppercase tracking-[0.2em] opacity-35">
					{live ? 'Plan ändern' : 'Plan wählen'}
				</p>
				<div class="flex flex-col gap-3 sm:flex-row">
					{#each TIER_PLANS as p (p.id)}
						{@render planCard(p)}
					{/each}
				</div>
			</div>
		{/if}

		<!-- Meine Bestellungen: each order expands into its in-app detail from
		     real order data. The official invoice is the one Creem mailed. -->
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
									<p class="pt-1 opacity-50">
										Die offizielle Rechnung hat dir Creem am {dateOf(order.createdAt)} per E‑Mail
										geschickt.
									</p>
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
