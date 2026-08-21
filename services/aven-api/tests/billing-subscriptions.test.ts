// The recurring tiers, proven end to end at the unit seam: products are
// seeded from the pricing SSOT (net cents, tagged by tier), subscription
// webhooks persist idempotently, and every read/action is scoped to the
// session's own user — a stranger's id never reaches provider or row.
import { randomUUID } from 'node:crypto'
import { PLANS } from '@avenos/aven-website/pricing'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CreemProvider } from '../src/lib/server/billing/creem.js'
import { parseCreemSubscriptionEvent } from '../src/lib/server/billing/provider.js'
import {
	SubscriptionService,
	subscriptionPlanSeeds
} from '../src/lib/server/billing/subscriptions.js'
import { createTestDatabase, type TestDatabase, testConfig } from './helpers.js'

const creemConfig = () =>
	testConfig({
		CREEM_API_KEY: 'creem_test_fake',
		CREEM_PRODUCT_ID: 'prod_avenid',
		CREEM_WEBHOOK_SECRET: 'whsec_test_secret'
	})

/** Collects every fetch the provider makes; answers from a scripted queue. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>) {
	const calls: Array<{ method: string; url: string; body: unknown; headers: Headers }> = []
	const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({
			method: init?.method ?? 'GET',
			url: String(input),
			body: init?.body ? JSON.parse(String(init.body)) : null,
			headers: new Headers(init?.headers)
		})
		const next = responses.shift() ?? { body: {} }
		return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
	})
	vi.stubGlobal('fetch', stub)
	return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('product seeding', () => {
	it('creates both tiers from PLANS with net cents and metadata.tier', async () => {
		const calls = stubFetch([
			{ body: { items: [] } },
			{ body: { id: 'prod_me' } },
			{ body: { id: 'prod_ceo' } }
		])
		const provider = new CreemProvider(creemConfig())
		const map = await provider.ensureSubscriptionProducts(subscriptionPlanSeeds())
		expect(map).toEqual({ avenme: 'prod_me', avenceo: 'prod_ceo' })

		const creations = calls.filter((c) => c.method === 'POST')
		expect(creations).toHaveLength(2)
		const byTier = Object.fromEntries(
			creations.map((c) => [(c.body as { metadata: { tier: string } }).metadata.tier, c.body])
		) as Record<string, Record<string, unknown>>
		// Prices come from the SSOT, in NET cents, recurring monthly, tax-exclusive.
		const avenme = PLANS.find((p) => p.id === 'avenme')
		const avenceo = PLANS.find((p) => p.id === 'avenceo')
		expect(byTier.avenme?.price).toBe((avenme?.eurPrice ?? 0) * 100)
		expect(byTier.avenceo?.price).toBe((avenceo?.eurPrice ?? 0) * 100)
		for (const body of Object.values(byTier)) {
			expect(body.billing_type).toBe('recurring')
			expect(body.tax_mode).toBe('exclusive')
			expect(body.currency).toBe('EUR')
		}
		// Every call authenticated — and only via the header, never a URL param.
		for (const call of calls) expect(call.headers.get('x-api-key')).toBe('creem_test_fake')
	})

	it('is idempotent: existing tagged products are reused, none created', async () => {
		const calls = stubFetch([
			{
				body: {
					items: [
						{ id: 'prod_me', metadata: { tier: 'avenme' } },
						{ id: 'prod_ceo', metadata: { tier: 'avenceo' } }
					]
				}
			}
		])
		const provider = new CreemProvider(creemConfig())
		const map = await provider.ensureSubscriptionProducts(subscriptionPlanSeeds())
		expect(map).toEqual({ avenme: 'prod_me', avenceo: 'prod_ceo' })
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
	})
})

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

	function subscriptionWebhook(input: {
		eventId: string
		subscriptionId: string
		userId: string
		email: string
		tier: string
		status: string
	}): string {
		return JSON.stringify({
			id: input.eventId,
			eventType: 'subscription.active',
			object: {
				id: input.subscriptionId,
				status: input.status,
				customer: { id: `cust_${input.userId.slice(0, 8)}`, email: input.email },
				product: { id: 'prod_me', price: 4200, metadata: { tier: input.tier } },
				current_period_end_date: '2026-09-21T00:00:00.000Z',
				metadata: { userId: input.userId, tier: input.tier }
			}
		})
	}

	it('applies a subscription webhook idempotently and scopes /me to the owner', async () => {
		const service = new SubscriptionService(
			database.pool,
			testConfig(),
			new CreemProvider(creemConfig())
		)
		const alice = await insertUser()
		const bob = await insertUser()
		const event = parseCreemSubscriptionEvent(
			subscriptionWebhook({
				eventId: `evt_${randomUUID()}`,
				subscriptionId: `sub_${randomUUID()}`,
				userId: alice.id,
				email: alice.email,
				tier: 'avenme',
				status: 'active'
			})
		)
		if (!event) throw new Error('event did not parse')

		expect(await service.applyEvent(event)).toEqual({ applied: true })
		// Replay: same event twice → still exactly one row, same state.
		expect(await service.applyEvent(event)).toEqual({ applied: true })
		const rows = await database.pool.query('SELECT * FROM subscriptions WHERE user_id=$1', [
			alice.id
		])
		expect(rows.rows).toHaveLength(1)
		expect(rows.rows[0].tier).toBe('avenme')
		expect(rows.rows[0].price_eur_cents).toBe(4200)

		// The customer key was captured — the handle every portal call hangs on.
		const customer = await database.pool.query(
			'SELECT creem_customer_id FROM billing_customers WHERE user_id=$1',
			[alice.id]
		)
		expect(customer.rows[0].creem_customer_id).toBe(`cust_${alice.id.slice(0, 8)}`)

		// Self-service isolation: the owner sees their standing, a stranger sees
		// null — there is no parameter with which bob could reach alice's row.
		const mine = await service.me(alice.id)
		expect(mine?.tier).toBe('avenme')
		expect(mine?.status).toBe('active')
		expect(await service.me(bob.id)).toBeNull()
	})

	it('actions resolve the provider id from the caller’s own row and proxy with the api key', async () => {
		const config = creemConfig()
		const alice = await insertUser()
		const bob = await insertUser()
		const subscriptionId = `sub_${randomUUID()}`
		const provider = new CreemProvider(config)
		const service = new SubscriptionService(database.pool, config, provider)
		const event = parseCreemSubscriptionEvent(
			subscriptionWebhook({
				eventId: `evt_${randomUUID()}`,
				subscriptionId,
				userId: alice.id,
				email: alice.email,
				tier: 'avenme',
				status: 'active'
			})
		)
		if (!event) throw new Error('event did not parse')
		await service.applyEvent(event)

		// Upgrade: the search answers the product map, then the change call must
		// target alice's OWN provider subscription id — taken from her row, not
		// from any client input.
		const calls = stubFetch([
			{
				body: {
					items: [
						{ id: 'prod_me', metadata: { tier: 'avenme' } },
						{ id: 'prod_ceo', metadata: { tier: 'avenceo' } }
					]
				}
			},
			{ body: { id: subscriptionId, status: 'active' } }
		])
		await service.change(alice.id, 'avenceo')
		const upgrade = calls.at(-1)
		if (!upgrade) throw new Error('no upgrade call was made')
		expect(upgrade.url).toContain(`/v1/subscriptions/${subscriptionId}/upgrade`)
		expect((upgrade.body as { product_id: string }).product_id).toBe('prod_ceo')
		expect(upgrade.headers.get('x-api-key')).toBe('creem_test_fake')

		// A stranger cannot act at all: bob holds no subscription, so the
		// service refuses before any provider call could happen.
		await expect(service.change(bob.id, 'avenceo')).rejects.toMatchObject({
			code: 'SUBSCRIPTION_MISSING'
		})
		await expect(service.cancel(bob.id)).rejects.toMatchObject({ code: 'SUBSCRIPTION_MISSING' })

		// Invoices: scoped by the caller's stored customer id; rows map to the
		// portal shape with the provider's hosted receipt link.
		// Creem sends unix-ms timestamps and NO receipt URL (TransactionEntity
		// has none) — the official documents live behind the portal link.
		const invoiceCalls = stubFetch([
			{
				body: {
					items: [
						{
							id: 'tx_1',
							created_at: 1787652000000,
							amount: 4998,
							tax_amount: 798,
							currency: 'EUR',
							status: 'paid',
							period_start: 1787652000000,
							period_end: 1790330400000
						}
					]
				}
			}
		])
		const invoices = await service.invoices(alice.id)
		expect(invoices).toEqual([
			{
				id: 'tx_1',
				createdAt: new Date(1787652000000).toISOString(),
				amountCents: 4998,
				taxCents: 798,
				currency: 'EUR',
				status: 'paid',
				periodStart: new Date(1787652000000).toISOString(),
				periodEnd: new Date(1790330400000).toISOString()
			}
		])
		expect(invoiceCalls[0]?.url).toContain(`customer_id=cust_${alice.id.slice(0, 8)}`)
		// Bob has no customer row → empty history, no provider call with a
		// guessed id.
		expect(await service.invoices(bob.id)).toEqual([])

		// The portal link — the only place official invoice documents exist —
		// is minted for the caller's own customer id; bob has none and is
		// refused before any provider call.
		const portalCalls = stubFetch([
			{ body: { customer_portal_link: 'https://creem.io/portal/abc' } }
		])
		expect(await service.portalUrl(alice.id)).toBe('https://creem.io/portal/abc')
		expect((portalCalls[0]?.body as { customer_id: string } | undefined)?.customer_id).toBe(
			`cust_${alice.id.slice(0, 8)}`
		)
		await expect(service.portalUrl(bob.id)).rejects.toMatchObject({
			code: 'BILLING_CUSTOMER_MISSING'
		})
	})
})
