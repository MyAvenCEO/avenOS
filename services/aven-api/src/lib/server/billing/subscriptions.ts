// The recurring tiers (avenME / avenCEO), sold through the payment provider
// and mirrored into two tables the portal reads. Strictly customer-self-
// service: every method takes the SESSION's user id — none accepts a
// provider id from outside, because the row lookup here is the authorization.
//
// The webhook is the only writer of subscription state. Actions (change,
// cancel, resume) call the provider and return; the row updates when the
// provider's event lands, so the UI shows a pending state instead of a lie.
import { randomUUID } from 'node:crypto'
import { PLANS, type Plan } from '@avenos/aven-website/pricing'
import type pg from 'pg'
import { writeAudit } from '../audit.js'
import { AppError } from '../errors.js'
import { ensureVerifiedUser } from '../identity.js'
import type {
	InvoiceRow,
	OrderRow,
	PaymentProvider,
	SubscriptionEvent,
	SubscriptionPlanSeed
} from './provider.js'

/** The tiers that exist at the provider: recurring, self-serve. avenID is a
 * one-off (the names flow owns it) and avenCOOP is not a product at all —
 * that relationship is handled individually, outside this system. */
export const SUBSCRIPTION_TIERS = ['avenme', 'avenceo'] as const
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number]

export function isSubscriptionTier(value: string): value is SubscriptionTier {
	return (SUBSCRIPTION_TIERS as readonly string[]).includes(value)
}

export function subscriptionPlanSeeds(): SubscriptionPlanSeed[] {
	return SUBSCRIPTION_TIERS.map((tier) => {
		// biome-ignore lint/style/noNonNullAssertion: SUBSCRIPTION_TIERS ⊂ PLANS ids.
		const plan: Plan = PLANS.find((p) => p.id === tier)!
		return {
			tier,
			name: plan.name,
			description: plan.role,
			// NET cents — the provider adds VAT on top ("zzgl. USt.").
			priceCents: Math.round(plan.eurPrice * 100)
		}
	})
}

export interface SubscriptionStanding {
	tier: string
	status: string
	priceEurCents: number
	currentPeriodEnd: string | null
	cancelAtPeriodEnd: boolean
}

interface SubscriptionRow {
	id: string
	user_id: string
	creem_subscription_id: string
	tier: string
	status: string
	current_period_end: Date | null
	cancel_at_period_end: boolean
	price_eur_cents: number
}

export class SubscriptionService {
	// tier → provider product id, resolved once per process. Seeding is
	// idempotent at the provider, so racing first calls are merely redundant.
	private products: Promise<Record<string, string>> | null = null

	constructor(
		private pool: pg.Pool,
		private config: { PUBLIC_BASE_URL: string },
		private payments: PaymentProvider
	) {}

	/** The caller's provider customer id — from our table first, and for
	 * members who paid before we stored customer ids (the one-off avenID), by
	 * asking the provider for the SESSION's own email. Found ids are stored,
	 * so the lookup happens once. */
	private async customerId(user: { id: string; email: string }): Promise<string | null> {
		const stored = await this.pool.query(
			'SELECT creem_customer_id FROM billing_customers WHERE user_id=$1',
			[user.id]
		)
		const known = stored.rows[0]?.creem_customer_id as string | undefined
		if (known) return known
		const found = await this.payments.findCustomerByEmail(user.email.toLowerCase())
		if (!found) return null
		await this.pool.query(
			`INSERT INTO billing_customers (user_id, creem_customer_id) VALUES ($1,$2)
			 ON CONFLICT (user_id) DO UPDATE SET creem_customer_id=EXCLUDED.creem_customer_id`,
			[user.id, found]
		)
		return found
	}

	/** Ensure the recurring products exist at the provider; cached per process. */
	ensureProducts(): Promise<Record<string, string>> {
		this.products ??= this.payments.ensureSubscriptionProducts(subscriptionPlanSeeds())
		return this.products
	}

	private async productId(tier: SubscriptionTier): Promise<string> {
		const id = (await this.ensureProducts())[tier]
		if (!id)
			throw new AppError(502, 'BILLING_PRODUCT_MISSING', `No provider product exists for ${tier}.`)
		return id
	}

	private async mine(userId: string): Promise<SubscriptionRow | null> {
		const result = await this.pool.query(
			'SELECT * FROM subscriptions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1',
			[userId]
		)
		return (result.rows[0] as SubscriptionRow | undefined) ?? null
	}

	/** The caller's standing — the session is the only selector. */
	async me(userId: string): Promise<SubscriptionStanding | null> {
		const row = await this.mine(userId)
		if (!row) return null
		return {
			tier: row.tier,
			status: row.status,
			priceEurCents: row.price_eur_cents,
			currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
			cancelAtPeriodEnd: row.cancel_at_period_end
		}
	}

	/** Start a checkout for a tier. With a live subscription the answer is
	 * `change()`, not a second checkout. */
	async subscribe(
		user: { id: string; email: string },
		tier: string
	): Promise<{ checkoutUrl: string }> {
		if (!isSubscriptionTier(tier))
			throw new AppError(400, 'VALIDATION_ERROR', 'Unknown subscription tier.')
		const existing = await this.mine(user.id)
		if (existing && !['canceled', 'expired'].includes(existing.status))
			throw new AppError(
				409,
				'SUBSCRIPTION_EXISTS',
				'You already have a subscription — change the plan instead.'
			)
		const session = await this.payments.createSubscriptionCheckout({
			productId: await this.productId(tier),
			tier,
			userId: user.id,
			email: user.email,
			successUrl: new URL('/dashboard', this.config.PUBLIC_BASE_URL).toString()
		})
		// Remember the checkout so the pane can ask "where does MY checkout
		// stand" without ever naming it.
		await this.pool.query('INSERT INTO billing_checkouts (user_id, checkout_id) VALUES ($1,$2)', [
			user.id,
			session.checkoutId
		])
		return { checkoutUrl: session.checkoutUrl }
	}

	/** Up- or downgrade to the other tier. Proration is charged immediately;
	 * the row flips when the provider's event arrives. */
	async change(userId: string, tier: string): Promise<void> {
		if (!isSubscriptionTier(tier))
			throw new AppError(400, 'VALIDATION_ERROR', 'Unknown subscription tier.')
		const row = await this.requireActive(userId)
		if (row.tier === tier)
			throw new AppError(409, 'SUBSCRIPTION_UNCHANGED', 'You are already on this plan.')
		await this.payments.changeSubscription(row.creem_subscription_id, await this.productId(tier))
	}

	async cancel(userId: string, immediate = false): Promise<void> {
		const row = await this.requireActive(userId)
		await this.payments.cancelSubscription(row.creem_subscription_id, immediate)
	}

	async resume(userId: string): Promise<void> {
		const row = await this.mine(userId)
		if (!row) throw new AppError(404, 'SUBSCRIPTION_MISSING', 'There is no subscription to resume.')
		await this.payments.resumeSubscription(row.creem_subscription_id)
	}

	/** The caller's invoice history, straight from the provider — including
	 * one-off purchases like the avenID, since the customer is resolved by
	 * the session's own email when our table does not know them yet. */
	async invoices(user: { id: string; email: string }): Promise<InvoiceRow[]> {
		const providerCustomerId = await this.customerId(user)
		if (!providerCustomerId) return []
		return this.payments.listInvoices(providerCustomerId)
	}

	/** The caller's orders — the one-off avenID and every subscription
	 * charge — resolved through the same session-only customer lookup. */
	async orders(user: { id: string; email: string }): Promise<OrderRow[]> {
		const providerCustomerId = await this.customerId(user)
		if (!providerCustomerId) return []
		return this.payments.listOrders(providerCustomerId)
	}

	async pause(userId: string): Promise<void> {
		const row = await this.requireActive(userId)
		await this.payments.pauseSubscription(row.creem_subscription_id)
	}

	/** Where the session's LATEST checkout stands. The checkout id comes
	 * from our own row, never from the client — the pane polls this while
	 * the inline embed runs, so it does not depend on the iframe message. */
	async checkoutStatus(userId: string): Promise<{ status: string } | null> {
		const row = await this.pool.query(
			'SELECT checkout_id FROM billing_checkouts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
			[userId]
		)
		const checkoutId = row.rows[0]?.checkout_id as string | undefined
		if (!checkoutId) return null
		return { status: await this.payments.checkoutStatus(checkoutId) }
	}

	private async requireActive(userId: string): Promise<SubscriptionRow> {
		const row = await this.mine(userId)
		if (!row || ['canceled', 'expired'].includes(row.status))
			throw new AppError(404, 'SUBSCRIPTION_MISSING', 'There is no active subscription.')
		return row
	}

	/** Apply one verified `subscription.*` webhook. Idempotent: keyed on the
	 * provider's subscription id, replays converge on the same row. The buyer
	 * is resolved from checkout metadata (userId) first, their email second —
	 * the same trust chain the names grant uses. */
	async applyEvent(event: SubscriptionEvent): Promise<{ applied: boolean }> {
		const client = await this.pool.connect()
		try {
			await client.query('BEGIN')
			let userId = event.userId
			if (userId) {
				const known = await client.query('SELECT id FROM "user" WHERE id=$1', [userId])
				if (!known.rows[0]) userId = null
			}
			if (!userId && event.email) {
				const user = await ensureVerifiedUser(client, event.email.toLowerCase(), 'subscription')
				userId = user.id
			}
			if (!userId) {
				await writeAudit(client, {
					eventType: 'billing.subscription_unmatched',
					metadata: { eventId: event.id, subscriptionId: event.providerSubscriptionId }
				})
				await client.query('COMMIT')
				return { applied: false }
			}
			if (event.providerCustomerId) {
				await client.query(
					`INSERT INTO billing_customers (user_id, creem_customer_id) VALUES ($1,$2)
					 ON CONFLICT (user_id) DO UPDATE SET creem_customer_id=EXCLUDED.creem_customer_id`,
					[userId, event.providerCustomerId]
				)
			}
			await client.query(
				`INSERT INTO subscriptions
				   (id, user_id, creem_subscription_id, tier, status, current_period_end,
				    cancel_at_period_end, price_eur_cents)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
				 ON CONFLICT (creem_subscription_id) DO UPDATE SET
				   status=EXCLUDED.status,
				   tier=COALESCE(NULLIF(EXCLUDED.tier,''), subscriptions.tier),
				   current_period_end=COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end),
				   cancel_at_period_end=EXCLUDED.cancel_at_period_end,
				   price_eur_cents=CASE WHEN EXCLUDED.price_eur_cents > 0
				     THEN EXCLUDED.price_eur_cents ELSE subscriptions.price_eur_cents END,
				   updated_at=now()`,
				[
					randomUUID(),
					userId,
					event.providerSubscriptionId,
					event.tier ?? '',
					event.status,
					event.currentPeriodEnd,
					event.cancelAtPeriodEnd,
					event.priceCents ?? 0
				]
			)
			await writeAudit(client, {
				eventType: 'billing.subscription_applied',
				metadata: {
					eventId: event.id,
					type: event.type,
					subscriptionId: event.providerSubscriptionId,
					status: event.status,
					tier: event.tier
				}
			})
			await client.query('COMMIT')
			return { applied: true }
		} catch (error) {
			await client.query('ROLLBACK')
			throw error
		} finally {
			client.release()
		}
	}
}
