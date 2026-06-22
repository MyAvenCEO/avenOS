import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks'
import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth, linkPolarCustomer, polarClient } from './auth'
import { db } from './db'
import { publish } from './events'
import {
	allTierBenefits,
	allTierPricesEur,
	setTierBenefits,
	setTierPriceEur
} from './tier-price-cache'

/**
 * Polar checkout + webhook for product tiers. board 0052 slice 2 (Polar billing).
 *
 * The pricing UI lives in the app (our own UI). This server creates the Polar checkout
 * session via the SDK and verifies the webhook that syncs subscriptions → the `tier`
 * column. Every checkout carries `externalCustomerId = user.id`, so the Polar customer is
 * always keyed to OUR user (the "merge user id" link), and the webhook reads it back —
 * keeping our DB / bot systems in sync with Polar as the billing source of truth.
 */

// Polar product ids per tier (sandbox defaults; overridable per-env for production). board 0052.
const AVENME_PRODUCT_ID =
	process.env.POLAR_AVENME_PRODUCT_ID ?? '949bd015-4909-4512-a3ac-dc0043cbdae6'
const AVENFOUNDER_PRODUCT_ID =
	process.env.POLAR_AVENFOUNDER_PRODUCT_ID ?? '8440114c-f672-4b6e-a8dc-21c592e97d2e'
const AVENCEO_PRODUCT_ID =
	process.env.POLAR_AVENCEO_PRODUCT_ID ?? '8f304678-f1b1-4d47-bd0f-320c1d35fe0b'

/**
 * Tier → Polar product + rank. THE single source of truth for paid tiers — add a row to wire a
 * new one. `rank` orders tiers so the UI/switch can tell an upgrade from a downgrade. Prices are
 * read LIVE from Polar (refreshTierPrices → tier-price-cache); credits.ts TIER_PRICE_EUR is only
 * the boot-time fallback.
 */
export const TIERS: Record<string, { productId: string; rank: number }> = {
	avenME: { productId: AVENME_PRODUCT_ID, rank: 1 },
	avenFOUNDER: { productId: AVENFOUNDER_PRODUCT_ID, rank: 2 },
	avenCEO: { productId: AVENCEO_PRODUCT_ID, rank: 3 }
}

// Reverse map (product id → tier), derived from TIERS so it can never drift.
const PRODUCT_TIER: Record<string, string> = Object.fromEntries(
	Object.entries(TIERS).map(([tier, cfg]) => [cfg.productId, tier])
)

/** Resolve a tier name OR explicit product id to a tier-granting Polar product id. */
function resolveProductId(input: { tier?: string; productId?: string }): string | undefined {
	if (input.productId && PRODUCT_TIER[input.productId]) return input.productId
	if (input.tier && TIERS[input.tier]) return TIERS[input.tier].productId
	return undefined
}

/**
 * Where Polar redirects after a successful checkout. The tier is actually applied by the
 * webhook (the source of truth), so this page is purely a "you're all set" confirmation.
 * Defaults to a small page served by this server (see the `/billing/success` route).
 */
function successUrl(): string {
	const base = process.env.BETTER_AUTH_URL ?? 'http://localhost:8787'
	return process.env.POLAR_CHECKOUT_SUCCESS_URL ?? `${base}/billing/success`
}

/** Map a Polar product id to our tier, or undefined if it isn't a tier-granting product. */
function tierForProduct(productId: string | null | undefined): string | undefined {
	return productId ? PRODUCT_TIER[productId] : undefined
}

/**
 * Reduce a customer's active subscriptions to the tier they entitle. The highest-priority
 * tier-granting product wins; no tier-granting subscription → `free`. Shared by the webhook
 * and the on-demand sync so both compute the entitlement identically.
 */
function tierFromActiveSubscriptions(subs: { productId: string }[] | undefined): string {
	return (subs ?? []).map((s) => tierForProduct(s.productId)).find(Boolean) ?? 'free'
}

/** Set a user's tier by their id (= Polar external_customer_id). No-op when id is missing. */
async function applyTier(userId: string | null | undefined, tier: string): Promise<void> {
	if (!userId) return
	await db().updateTable('user').set({ tier }).where('id', '=', userId).execute()
}

// ── Live tier prices (Polar is the SSOT; we cache so the credit hot-path + state read don't
// hit the API every time). The UI shows these and credits.ts derives the MINDS allowance from
// them — nothing about price is hardcoded in the app any more. board 0052.
let priceCacheAt = 0
const PRICE_TTL_MS = 5 * 60_000

/** Fetch each tier's current weekly price from Polar into the shared cache. Best-effort. */
export async function refreshTierPrices(): Promise<void> {
	const client = polarClient
	if (!client) return
	await Promise.all(
		Object.entries(TIERS).map(async ([tier, cfg]) => {
			try {
				const product = await client.products.get({ id: cfg.productId })
				const fixed = (product.prices ?? []).find(
					(p) => typeof (p as { priceAmount?: number }).priceAmount === 'number'
				) as { priceAmount?: number } | undefined
				if (fixed?.priceAmount != null) setTierPriceEur(tier, fixed.priceAmount / 100)
				// Card feature list = the product's Polar benefit descriptions (Polar is the SSOT).
				setTierBenefits(
					tier,
					(product.benefits ?? [])
						.map((b) => (b as { description?: string }).description ?? '')
						.filter(Boolean)
				)
			} catch (e) {
				console.error(
					`[billing] price fetch failed for ${tier}:`,
					e instanceof Error ? e.message : e
				)
			}
		})
	)
	priceCacheAt = Date.now()
}

/** Refresh prices when the cache is older than the TTL (no-op otherwise). */
async function ensureTierPrices(): Promise<void> {
	if (Date.now() - priceCacheAt > PRICE_TTL_MS) await refreshTierPrices()
}

/**
 * Session-gated: create a Polar checkout session for the signed-in user and return its URL.
 * The app redirects the browser to it (Polar-hosted, PCI-compliant card entry). We pass
 * `externalCustomerId = user.id` so the resulting Polar customer is tied to our user — and
 * we proactively (re)link the customer first so a checkout can never conflict on a stale
 * external_id (e.g. after a DB reset). board 0052.
 */
export async function billingCheckout(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)

	const body = (await c.req.json().catch(() => null)) as {
		productId?: string
		tier?: string
		returnUrl?: string
	} | null
	const productId = resolveProductId(body ?? {}) ?? AVENME_PRODUCT_ID
	if (!tierForProduct(productId)) return c.json({ error: 'unknown_product' }, 400)

	const user = session.user as { id: string; email: string; name?: string }
	// Best-effort: make sure the Polar customer exists with external_id = user.id before checkout.
	await linkPolarCustomer(user)

	// The app passes its own origin as returnUrl so the user lands back IN the app. But the PACKAGED
	// desktop webview's origin is a non-http scheme (tauri://localhost), and Polar REJECTS a non
	// http(s) successUrl — which 502s the whole checkout ("checkout_failed"). Only honor an http(s)
	// returnUrl; otherwise fall back to our own https success page. (Local dev works because there the
	// origin is http://localhost:<port>.) board 0061.
	const requestedReturn = body?.returnUrl
	const checkoutSuccessUrl =
		requestedReturn && /^https?:\/\//i.test(requestedReturn) ? requestedReturn : successUrl()

	try {
		const checkout = await polarClient.checkouts.create({
			products: [productId],
			externalCustomerId: user.id,
			customerEmail: user.email,
			successUrl: checkoutSuccessUrl
		})
		return c.json({ url: checkout.url })
	} catch (e) {
		console.error('[billing] checkout create failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'checkout_failed' }, 502)
	}
}

/**
 * Polar webhook → sync the user's `tier`. Verified via POLAR_WEBHOOK_SECRET (Standard
 * Webhooks signature; `validateEvent` base64-encodes the secret for us).
 *
 * `customer.state_changed` is the authoritative event: it carries the customer's external_id
 * (= our user.id) and their CURRENT active subscriptions, so we recompute the tier from
 * scratch (an active tier-granting product → that tier, otherwise free). This one event
 * covers activate / renew / cancel-at-period-end / revoke. We also honor the explicit
 * subscription.* events as a fallback, in case only those are enabled on the endpoint.
 */
export async function billingWebhook(c: Context): Promise<Response> {
	const secret = process.env.POLAR_WEBHOOK_SECRET
	if (!secret) return c.json({ error: 'webhook_not_configured' }, 503)

	const raw = await c.req.text()
	// Standard Webhooks needs the webhook-id / -signature / -timestamp headers as a plain
	// record. (`Headers` isn't typed iterable under this lib config, so build it via forEach.)
	const headers: Record<string, string> = {}
	c.req.raw.headers.forEach((value, key) => {
		headers[key] = value
	})

	let event: ReturnType<typeof validateEvent>
	try {
		event = validateEvent(raw, headers, secret)
	} catch (e) {
		if (e instanceof WebhookVerificationError) return c.json({ error: 'invalid_signature' }, 403)
		console.error('[billing] webhook parse failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'bad_request' }, 400)
	}

	// Audit: persist every verified event, keyed on the Standard Webhooks delivery id so
	// redeliveries are no-ops. Purely a log — the UI still reads billing state live from Polar.
	// Best-effort: an audit failure must not block (or duplicate) tier reconciliation. board 0052.
	const eventId = headers['webhook-id']
	if (eventId) {
		const data = event.data as { externalId?: string; customer?: { externalId?: string } }
		const externalId = data.externalId ?? data.customer?.externalId ?? null
		try {
			await db()
				.insertInto('polar_event')
				.values({
					event_id: eventId,
					type: event.type,
					external_id: externalId,
					payload: sql`${JSON.stringify(event)}::jsonb`
				})
				.onConflict((oc) => oc.column('event_id').doNothing())
				.execute()
		} catch (e) {
			console.error('[billing] webhook audit insert failed:', e instanceof Error ? e.message : e)
		}
	}

	try {
		switch (event.type) {
			case 'customer.state_changed': {
				// Both CustomerState union members expose externalId + activeSubscriptions.
				await applyTier(
					event.data.externalId,
					tierFromActiveSubscriptions(event.data.activeSubscriptions)
				)
				publish(event.data.externalId, { entity: 'billing' })
				break
			}
			case 'subscription.active':
			case 'subscription.created':
			case 'subscription.updated':
			case 'subscription.uncanceled': {
				const sub = event.data
				const tier = tierForProduct(sub.productId)
				if (tier && (sub.status === 'active' || sub.status === 'trialing')) {
					await applyTier(sub.customer.externalId, tier)
				} else if (sub.status === 'canceled') {
					await applyTier(sub.customer.externalId, 'free')
				}
				publish(sub.customer.externalId, { entity: 'billing' })
				break
			}
			case 'subscription.revoked': {
				await applyTier(event.data.customer.externalId, 'free')
				publish(event.data.customer.externalId, { entity: 'billing' })
				break
			}
		}
	} catch (e) {
		// A transient DB error shouldn't make Polar retry forever — `customer.state_changed`
		// reconciles the tier on the next change. Ack with 200 regardless.
		console.error('[billing] webhook handling failed:', e instanceof Error ? e.message : e)
	}

	return c.json({ ok: true })
}

/** Collect the first page of items from a Polar SDK list iterator (enough for one user). */
async function firstPageItems<T>(pager: AsyncIterable<{ result: { items: T[] } }>): Promise<T[]> {
	for await (const page of pager) return page.result.items
	return []
}

/**
 * Pull the user's current Polar state and persist the resulting tier. Returns the tier
 * ('free' when there's no Polar customer yet). The single server-side reconcile used by the
 * sync endpoint and after every self-service change so our DB always matches Polar.
 */
async function reconcileTier(userId: string): Promise<string> {
	if (!polarClient) return 'free'
	try {
		const state = await polarClient.customers.getStateExternal({ externalId: userId })
		const tier = tierFromActiveSubscriptions(state.activeSubscriptions)
		await applyTier(userId, tier)
		return tier
	} catch (e) {
		const status =
			(e as { statusCode?: number; status?: number })?.statusCode ??
			(e as { status?: number })?.status
		if (status === 404) {
			await applyTier(userId, 'free')
			return 'free'
		}
		throw e
	}
}

/**
 * The skill names currently GRANTED to the user, read from Polar feature-flag benefits
 * (each skill benefit carries metadata `{ skill: "<name>" }`). This is the entitlement model:
 * Polar grants/revokes the benefit per subscription, and we read `granted_benefits` rather than
 * inferring skills from the tier ourselves. Returns [] on no customer / error.
 */
async function grantedSkills(userId: string): Promise<string[]> {
	if (!polarClient) return []
	try {
		const state = await polarClient.customers.getStateExternal({ externalId: userId })
		const skills = new Set<string>()
		for (const grant of state.grantedBenefits ?? []) {
			const skill = (grant.benefitMetadata as Record<string, unknown> | undefined)?.skill
			if (typeof skill === 'string' && skill) skills.add(skill)
		}
		return [...skills]
	} catch {
		return []
	}
}

/**
 * Session-gated on-demand reconcile: pull the signed-in user's CURRENT state from Polar
 * (by external_id = user.id) and set their `tier` from the active subscriptions. Returns the
 * resolved tier so the UI can refresh immediately.
 *
 * This is the robust, webhook-independent path: the app calls it right after returning from
 * checkout (and can call it on focus/poll). It makes entitlements work locally with no public
 * webhook URL, and acts as a safety net in production if a webhook is ever missed/delayed.
 */
export async function billingSync(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)

	const user = session.user as { id: string; email: string; name?: string }
	// Ensure the Polar customer exists & is keyed to this user before reading its state.
	await linkPolarCustomer(user)

	try {
		const tier = await reconcileTier(user.id)
		publish(user.id, { entity: 'billing' })
		return c.json({ tier })
	} catch (e) {
		console.error('[billing] sync failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'sync_failed' }, 502)
	}
}

/**
 * Session-gated: the signed-in user's subscriptions + orders, read live from Polar (scoped to
 * external_id = user.id). Powers the "my subscriptions & orders" + manage-plan UI entirely in
 * our own app — no Polar-hosted portal. Also reconciles the cached tier as a side effect.
 */
export async function billingState(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)
	const user = session.user as { id: string; email: string; name?: string }
	await linkPolarCustomer(user)

	try {
		const [subsPager, ordersPager, skills] = await Promise.all([
			polarClient.subscriptions.list({ externalCustomerId: user.id, limit: 50 }),
			polarClient.orders.list({ externalCustomerId: user.id, limit: 50 }),
			grantedSkills(user.id),
			ensureTierPrices() // refresh live prices (cached; the UI reads them below)
		])
		const subs = await firstPageItems(subsPager)
		const orders = await firstPageItems(ordersPager)

		// A canceled-at-period-end subscription is still `active` until the period ends, so it
		// keeps granting its tier. Reconcile the DB tier from the active set while we're here.
		const activeTierSubs = subs.filter((s) => s.status === 'active' || s.status === 'trialing')
		const tier = tierFromActiveSubscriptions(
			activeTierSubs.map((s) => ({ productId: s.productId }))
		)
		await applyTier(user.id, tier)

		return c.json({
			tier,
			// Live weekly price (EUR) per tier, straight from Polar — the UI renders these, never hardcoded.
			prices: allTierPricesEur(),
			// Card feature bullets per tier — the Polar product benefit descriptions (Polar = SSOT).
			benefits: allTierBenefits(),
			// Skills the user is actually entitled to, from Polar feature-flag benefits (not inferred).
			skills,
			subscriptions: subs.map((s) => ({
				id: s.id,
				productId: s.productId,
				tier: tierForProduct(s.productId) ?? null,
				status: s.status,
				amount: s.amount,
				currency: s.currency,
				recurringInterval: s.recurringInterval,
				currentPeriodEnd: s.currentPeriodEnd,
				cancelAtPeriodEnd: s.cancelAtPeriodEnd,
				endsAt: s.endsAt
			})),
			orders: orders.map((o) => ({
				id: o.id,
				createdAt: o.createdAt,
				status: o.status,
				paid: o.paid,
				amount: o.totalAmount,
				currency: o.currency,
				billingReason: o.billingReason,
				productId: o.productId
			}))
		})
	} catch (e) {
		console.error('[billing] state failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'state_failed' }, 502)
	}
}

/** Find the signed-in user's currently-active subscription (the one self-service acts on). */
async function activeSubscription(userId: string) {
	if (!polarClient) return null
	const subs = await firstPageItems(
		await polarClient.subscriptions.list({ externalCustomerId: userId, active: true, limit: 10 })
	)
	return subs[0] ?? null
}

/**
 * Session-gated self-service cancel. `mode: 'period_end'` (default) keeps access until the
 * renewal date then drops to free; `mode: 'immediate'` revokes now. Reconciles the tier and
 * returns it. With only avenCITY + free today, cancel == downgrade-to-free; when paid tiers
 * ship, switching between them is the same `subscriptions.update` with a `productId`.
 */
export async function billingCancel(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)
	const user = session.user as { id: string }
	const body = (await c.req.json().catch(() => null)) as {
		mode?: 'period_end' | 'immediate'
	} | null
	const immediate = body?.mode === 'immediate'

	try {
		const sub = await activeSubscription(user.id)
		if (!sub) return c.json({ error: 'no_active_subscription' }, 404)
		const id = sub.id
		if (immediate) await polarClient.subscriptions.revoke({ id })
		else
			await polarClient.subscriptions.update({
				id,
				subscriptionUpdate: { cancelAtPeriodEnd: true }
			})
		const tier = await reconcileTier(user.id)
		publish(user.id, { entity: 'billing' })
		return c.json({ ok: true, mode: immediate ? 'immediate' : 'period_end', tier })
	} catch (e) {
		console.error('[billing] cancel failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'cancel_failed' }, 502)
	}
}

/** Session-gated: reverse a scheduled cancellation (resume the subscription). */
export async function billingUncancel(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)
	const user = session.user as { id: string }

	try {
		const sub = await activeSubscription(user.id)
		if (!sub) return c.json({ error: 'no_active_subscription' }, 404)
		await polarClient.subscriptions.update({
			id: sub.id,
			subscriptionUpdate: { cancelAtPeriodEnd: false }
		})
		const tier = await reconcileTier(user.id)
		publish(user.id, { entity: 'billing' })
		return c.json({ ok: true, tier })
	} catch (e) {
		console.error('[billing] uncancel failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'uncancel_failed' }, 502)
	}
}

/**
 * Session-gated self-service plan switch (upgrade/downgrade between PAID tiers). Changes the
 * active subscription's product; Polar prorates per the org's default behavior. Reconciles the
 * tier and returns it. For a free → paid move there's no active subscription, so the client
 * uses checkout instead (we return 404 here so it can fall back).
 */
export async function billingSwitch(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)
	const user = session.user as { id: string }
	const body = (await c.req.json().catch(() => null)) as {
		tier?: string
		productId?: string
	} | null
	const productId = resolveProductId(body ?? {})
	if (!productId) return c.json({ error: 'unknown_product' }, 400)

	try {
		const sub = await activeSubscription(user.id)
		if (!sub) return c.json({ error: 'no_active_subscription' }, 404)
		// Polar won't change the plan of a subscription that's scheduled to cancel — so if the
		// user is mid-cancellation, auto-uncancel first. Switching to another tier implies they
		// want to keep a subscription, so reversing the pending cancel is the correct behavior.
		if (sub.cancelAtPeriodEnd) {
			await polarClient.subscriptions.update({
				id: sub.id,
				subscriptionUpdate: { cancelAtPeriodEnd: false }
			})
		}
		// Then change the product (skip if they're already on the target — e.g. "switch" that only
		// needed to reverse a cancel). Polar prorates per the org default.
		if (sub.productId !== productId) {
			await polarClient.subscriptions.update({ id: sub.id, subscriptionUpdate: { productId } })
		}
		const tier = await reconcileTier(user.id)
		publish(user.id, { entity: 'billing' })
		return c.json({ ok: true, tier })
	} catch (e) {
		console.error('[billing] switch failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'switch_failed' }, 502)
	}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Get an order's invoice URL, generating it first if Polar hasn't yet (then polling briefly). */
async function invoiceUrlForOrder(orderId: string): Promise<string> {
	if (!polarClient) throw new Error('billing_not_configured')
	try {
		return (await polarClient.orders.invoice({ id: orderId })).url
	} catch {
		/* not generated yet → generate + poll below */
	}
	await polarClient.orders.generateInvoice({ id: orderId })
	for (let i = 0; i < 8; i++) {
		await sleep(1000)
		try {
			return (await polarClient.orders.invoice({ id: orderId })).url
		} catch {
			/* keep polling — generation usually finishes within a few seconds */
		}
	}
	throw new Error('invoice_not_ready')
}

/**
 * Session-gated: stream a paid order's invoice PDF through our server. The app's CSP doesn't
 * allow the webview to reach Polar's invoice S3 URL directly (frame/connect-src), so we proxy
 * the bytes — the client wraps them in a `blob:` URL (which the CSP does allow) to preview +
 * download. Verifies the order belongs to the signed-in user before generating/streaming.
 */
export async function billingOrderInvoice(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if (!polarClient) return c.json({ error: 'billing_not_configured' }, 503)
	const user = session.user as { id: string }
	const orderId = c.req.param('id')
	if (!orderId) return c.json({ error: 'order_id_required' }, 400)

	try {
		const order = await polarClient.orders.get({ id: orderId })
		if (order.customer?.externalId !== user.id) return c.json({ error: 'forbidden' }, 403)
		const url = await invoiceUrlForOrder(orderId)
		const pdf = await fetch(url)
		if (!pdf.ok || !pdf.body) return c.json({ error: 'invoice_fetch_failed' }, 502)
		return new Response(pdf.body, {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="invoice-${orderId}.pdf"`,
				'Cache-Control': 'private, max-age=300'
			}
		})
	} catch (e) {
		const status = (e as { statusCode?: number })?.statusCode
		if (status === 404) return c.json({ error: 'order_not_found' }, 404)
		console.error('[billing] invoice failed:', e instanceof Error ? e.message : e)
		return c.json({ error: 'invoice_failed' }, 502)
	}
}
