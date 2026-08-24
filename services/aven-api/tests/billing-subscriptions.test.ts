// The recurring tiers, proven end to end at the unit seam: subscription
// webhooks persist idempotently PER TIER (avenME and avenFOUNDER are
// independent products that coexist on one account), every read/action is
// scoped to the session's own user — a stranger's id never reaches provider
// or row — and the invoice URL only ever resolves the caller's own orders.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
	CheckoutInput,
	CheckoutSession,
	OrderRow,
	PaymentEvent,
	PaymentProvider,
	ProductSeed,
	SubscriptionCheckoutInput
} from '../src/lib/server/billing/provider.js'
import { parsePolarSubscriptionEvent } from '../src/lib/server/billing/provider.js'
import { SubscriptionService } from '../src/lib/server/billing/subscriptions.js'
import { createTestDatabase, type TestDatabase, testConfig } from './helpers.js'

/** Records every provider call, so the tests can assert WHICH provider
 * subscription id an action targeted — always the caller's own row. */
class StubProvider implements PaymentProvider {
	readonly kind = 'polar' as const
	calls: Array<{ method: string; args: unknown[] }> = []
	ordersByCustomer: Record<string, OrderRow[]> = {}

	private record(method: string, ...args: unknown[]) {
		this.calls.push({ method, args })
	}

	async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
		this.record('createCheckout', input)
		return { checkoutId: `ch_${input.holdId}`, checkoutUrl: 'https://sandbox.polar.sh/checkout' }
	}

	verifyWebhook(): PaymentEvent {
		throw new Error('not used in these tests')
	}

	async ensureProducts(seeds: ProductSeed[]): Promise<Record<string, string>> {
		this.record('ensureProducts', seeds)
		return Object.fromEntries(seeds.map((seed) => [seed.tier, `prod_${seed.tier}`]))
	}

	async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
		this.record('createSubscriptionCheckout', input)
		return {
			checkoutId: `ch_${input.tier}_${input.userId.slice(0, 8)}`,
			checkoutUrl: `https://sandbox.polar.sh/checkout/${input.tier}`
		}
	}

	async cancelSubscription(id: string, immediate: boolean): Promise<void> {
		this.record('cancelSubscription', id, immediate)
	}

	async resumeSubscription(id: string): Promise<void> {
		this.record('resumeSubscription', id)
	}

	async findCustomerByEmail(email: string): Promise<string | null> {
		this.record('findCustomerByEmail', email)
		return null
	}

	async listOrders(customerId: string): Promise<OrderRow[]> {
		this.record('listOrders', customerId)
		return this.ordersByCustomer[customerId] ?? []
	}

	async orderInvoiceUrl(orderId: string): Promise<string> {
		this.record('orderInvoiceUrl', orderId)
		return `https://polar.sh/invoices/${orderId}.pdf`
	}

	async checkoutStatus(checkoutId: string): Promise<string> {
		this.record('checkoutStatus', checkoutId)
		return 'completed'
	}
}

function subscriptionWebhook(input: {
	subscriptionId: string
	userId: string
	email: string
	tier: string
	status: string
	cancelAtPeriodEnd?: boolean
	amount?: number
}): string {
	return JSON.stringify({
		type: 'subscription.active',
		data: {
			id: input.subscriptionId,
			status: input.status,
			amount: input.amount ?? 5500,
			current_period_end: '2026-09-21T00:00:00.000Z',
			cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
			customer: {
				id: `cust_${input.userId.slice(0, 8)}`,
				email: input.email,
				external_id: input.userId
			},
			product: { id: `prod_${input.tier}`, metadata: { tier: input.tier } },
			metadata: { userId: input.userId, tier: input.tier }
		}
	})
}

describe('subscription state', () => {
	let database: TestDatabase
	beforeAll(async () => {
		database = await createTestDatabase()
	})
	afterAll(async () => {
		await database.teardown()
	})

	async function insertUser(): Promise<{ id: string; email: string }> {
		const id = randomUUID()
		const email = `u${id.slice(0, 8)}@example.test`
		await database.pool.query(
			`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
			 VALUES ($1, $2, $3, true, now(), now())`,
			[id, email.split('@')[0], email]
		)
		return { id, email }
	}

	async function applyWebhook(
		service: SubscriptionService,
		input: Parameters<typeof subscriptionWebhook>[0]
	) {
		const event = parsePolarSubscriptionEvent(subscriptionWebhook(input))
		if (!event) throw new Error('event did not parse')
		return service.applyEvent(event)
	}

	it('applies a subscription webhook idempotently and scopes /me to the owner', async () => {
		const provider = new StubProvider()
		const service = new SubscriptionService(database.pool, testConfig(), provider)
		const alice = await insertUser()
		const bob = await insertUser()
		const subscriptionId = `sub_${randomUUID()}`

		expect(
			await applyWebhook(service, {
				subscriptionId,
				userId: alice.id,
				email: alice.email,
				tier: 'avenme',
				status: 'active'
			})
		).toEqual({ applied: true })
		// Replay: same event twice → still exactly one row, same state.
		expect(
			await applyWebhook(service, {
				subscriptionId,
				userId: alice.id,
				email: alice.email,
				tier: 'avenme',
				status: 'active'
			})
		).toEqual({ applied: true })
		const rows = await database.pool.query('SELECT * FROM subscriptions WHERE user_id=$1', [
			alice.id
		])
		expect(rows.rows).toHaveLength(1)
		expect(rows.rows[0].tier).toBe('avenme')
		expect(rows.rows[0].price_eur_cents).toBe(5500)

		// The customer key was captured — the handle every portal call hangs on.
		const customer = await database.pool.query(
			'SELECT provider_customer_id FROM billing_customers WHERE user_id=$1',
			[alice.id]
		)
		expect(customer.rows[0].provider_customer_id).toBe(`cust_${alice.id.slice(0, 8)}`)

		// Self-service isolation: the owner sees their standing, a stranger
		// sees nothing — there is no parameter that reaches alice's row.
		const mine = await service.me(alice.id)
		expect(mine).toHaveLength(1)
		expect(mine[0]).toMatchObject({ tier: 'avenme', status: 'active' })
		expect(await service.me(bob.id)).toEqual([])
	})

	it('tiers are independent: both can be active, only a same-tier duplicate is refused', async () => {
		const provider = new StubProvider()
		const service = new SubscriptionService(database.pool, testConfig(), provider)
		const alice = await insertUser()

		await applyWebhook(service, {
			subscriptionId: `sub_${randomUUID()}`,
			userId: alice.id,
			email: alice.email,
			tier: 'avenme',
			status: 'active'
		})
		await applyWebhook(service, {
			subscriptionId: `sub_${randomUUID()}`,
			userId: alice.id,
			email: alice.email,
			tier: 'avenceo',
			status: 'active',
			amount: 37700
		})

		// Both tiers stand side by side on one account.
		const mine = await service.me(alice.id)
		expect(mine.map((standing) => standing.tier).sort()).toEqual(['avenceo', 'avenme'])
		expect(mine.find((standing) => standing.tier === 'avenceo')?.priceEurCents).toBe(37700)

		// A second booking of the SAME tier is refused; there is no cross-tier
		// change of any kind — the other tier is simply its own product.
		await expect(service.subscribe(alice, 'avenme')).rejects.toMatchObject({
			code: 'SUBSCRIPTION_EXISTS'
		})
		await expect(service.subscribe(alice, 'avenceo')).rejects.toMatchObject({
			code: 'SUBSCRIPTION_EXISTS'
		})
		// An ended subscription frees the tier again.
		const endedId = `sub_${randomUUID()}`
		const carol = await insertUser()
		await applyWebhook(service, {
			subscriptionId: endedId,
			userId: carol.id,
			email: carol.email,
			tier: 'avenme',
			status: 'canceled'
		})
		const started = await service.subscribe(carol, 'avenme')
		expect(started.checkoutUrl).toContain('/checkout/avenme')
	})

	it('actions are tier-scoped and resolve the provider id from the caller’s own row', async () => {
		const provider = new StubProvider()
		const service = new SubscriptionService(database.pool, testConfig(), provider)
		const alice = await insertUser()
		const bob = await insertUser()
		const meId = `sub_me_${randomUUID()}`
		const ceoId = `sub_ceo_${randomUUID()}`
		await applyWebhook(service, {
			subscriptionId: meId,
			userId: alice.id,
			email: alice.email,
			tier: 'avenme',
			status: 'active'
		})
		await applyWebhook(service, {
			subscriptionId: ceoId,
			userId: alice.id,
			email: alice.email,
			tier: 'avenceo',
			status: 'active',
			cancelAtPeriodEnd: true
		})

		// Cancel hits the avenME row only — the id comes from HER row.
		await service.cancel(alice.id, 'avenme')
		expect(provider.calls.at(-1)).toEqual({ method: 'cancelSubscription', args: [meId, false] })
		await service.cancel(alice.id, 'avenme', true)
		expect(provider.calls.at(-1)).toEqual({ method: 'cancelSubscription', args: [meId, true] })

		// Resume reverts a scheduled cancellation, per tier.
		await service.resume(alice.id, 'avenceo')
		expect(provider.calls.at(-1)).toEqual({ method: 'resumeSubscription', args: [ceoId] })
		await service.resume(alice.id, 'avenme')
		expect(provider.calls.at(-1)).toEqual({ method: 'resumeSubscription', args: [meId] })

		// A stranger cannot act at all: bob holds nothing, so the service
		// refuses before any provider call could happen.
		await expect(service.cancel(bob.id, 'avenme')).rejects.toMatchObject({
			code: 'SUBSCRIPTION_MISSING'
		})
		await expect(service.resume(bob.id, 'avenceo')).rejects.toMatchObject({
			code: 'SUBSCRIPTION_MISSING'
		})
		// And an unknown tier never reaches the database.
		await expect(service.cancel(alice.id, 'avencoop')).rejects.toMatchObject({
			code: 'VALIDATION_ERROR'
		})
	})

	it('orders and the invoice URL resolve strictly against the caller’s own customer', async () => {
		const provider = new StubProvider()
		const service = new SubscriptionService(database.pool, testConfig(), provider)
		const alice = await insertUser()
		const bob = await insertUser()
		await applyWebhook(service, {
			subscriptionId: `sub_${randomUUID()}`,
			userId: alice.id,
			email: alice.email,
			tier: 'avenme',
			status: 'active'
		})
		const customerId = `cust_${alice.id.slice(0, 8)}`
		provider.ordersByCustomer[customerId] = [
			{
				id: 'ord_1',
				createdAt: '2026-08-24T00:00:00.000Z',
				productId: 'prod_avenme',
				tier: 'avenme',
				subTotalCents: 4622,
				taxCents: 878,
				discountCents: 0,
				amountPaidCents: 5500,
				currency: 'eur',
				status: 'paid',
				invoiceGenerated: false
			}
		]

		const orders = await service.orders(alice)
		expect(orders).toHaveLength(1)
		expect(orders[0]).toMatchObject({ id: 'ord_1', tier: 'avenme', amountPaidCents: 5500 })
		expect(provider.calls.at(-1)).toEqual({ method: 'listOrders', args: [customerId] })

		// The invoice URL: an owned order id resolves; a foreign or invented
		// one is simply not found — it never reaches the provider.
		const url = await service.orderInvoiceUrl(alice, 'ord_1')
		expect(url).toBe('https://polar.sh/invoices/ord_1.pdf')
		const before = provider.calls.length
		await expect(service.orderInvoiceUrl(alice, 'ord_foreign')).rejects.toMatchObject({
			code: 'ORDER_MISSING'
		})
		expect(
			provider.calls.slice(before).filter((call) => call.method === 'orderInvoiceUrl')
		).toHaveLength(0)

		// Bob has no customer row → empty history, no provider call with a
		// guessed id (the only lookup is by his own email).
		expect(await service.orders(bob)).toEqual([])
		expect(provider.calls.at(-1)).toEqual({ method: 'findCustomerByEmail', args: [bob.email] })

		// A legacy Creem-era id in the column never reaches the provider —
		// the lookup self-heals via the session's own email instead.
		const carl = await insertUser()
		await database.pool.query(
			'INSERT INTO billing_customers (user_id, provider_customer_id) VALUES ($1,$2)',
			[carl.id, 'cus_creem_legacy']
		)
		expect(await service.orders(carl)).toEqual([])
		expect(
			provider.calls.filter((c) => c.method === 'listOrders' && c.args[0] === 'cus_creem_legacy')
		).toHaveLength(0)
		expect(provider.calls.at(-1)).toEqual({ method: 'findCustomerByEmail', args: [carl.email] })
	})

	it('reports the session’s own latest checkout without accepting an id', async () => {
		const provider = new StubProvider()
		const service = new SubscriptionService(database.pool, testConfig(), provider)
		const carol = await insertUser()
		const dave = await insertUser()

		const started = await service.subscribe(carol, 'avenme', 'http://127.0.0.1:1420')
		expect(started.checkoutUrl).toContain('/checkout/avenme')
		// The embed origin travels to the provider — Polar validates it
		// against the org's allowlist; it authorizes nothing on our side.
		const checkoutCall = provider.calls.find((c) => c.method === 'createSubscriptionCheckout')
		expect(checkoutCall?.args[0]).toMatchObject({
			tier: 'avenme',
			userId: carol.id,
			embedOrigin: 'http://127.0.0.1:1420'
		})

		expect(await service.checkoutStatus(carol.id)).toEqual({ status: 'completed' })
		expect(provider.calls.at(-1)).toEqual({
			method: 'checkoutStatus',
			args: [`ch_avenme_${carol.id.slice(0, 8)}`]
		})
		// dave never started one: null, and no provider call with a guessed id.
		const before = provider.calls.length
		expect(await service.checkoutStatus(dave.id)).toBeNull()
		expect(provider.calls.length).toBe(before)
	})
})
