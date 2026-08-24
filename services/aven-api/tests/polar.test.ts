// The Polar boundary at the unit seam: the factory picks the provider by
// config, Standard-Webhooks signatures round-trip (and tampering is caught),
// and the raw-wire parsers normalize Polar envelopes into the shapes the
// rest of the service sees.
import { describe, expect, it } from 'vitest'
import { createPaymentProvider, FakePaymentProvider } from '../src/lib/server/billing/fake.js'
import { PolarProvider } from '../src/lib/server/billing/polar.js'
import {
	assertWebhookSignature,
	parsePolarCustomerState,
	parsePolarEvent,
	parsePolarSubscriptionEvent,
	signWebhookHeaders
} from '../src/lib/server/billing/provider.js'
import { productSeeds } from '../src/lib/server/billing/seeds.js'
import { testConfig } from './helpers.js'

const SECRET = 'whsec_test_secret'

function thrownBy(fn: () => unknown): unknown {
	try {
		fn()
	} catch (error) {
		return error
	}
	throw new Error('expected the call to throw')
}

const polarConfig = () =>
	testConfig({ POLAR_API_KEY: 'polar_pat_fake', POLAR_WEBHOOK_SECRET: SECRET })

describe('provider factory', () => {
	it('picks Polar when POLAR_API_KEY is set, the fake otherwise', () => {
		expect(createPaymentProvider(polarConfig())).toBeInstanceOf(PolarProvider)
		expect(createPaymentProvider(polarConfig()).kind).toBe('polar')
		expect(createPaymentProvider(testConfig())).toBeInstanceOf(FakePaymentProvider)
		expect(createPaymentProvider(testConfig()).kind).toBe('fake')
	})
})

describe('product seeds', () => {
	it('come from the SSOT: gross cents, avenID one-time, tiers monthly', () => {
		const seeds = productSeeds()
		expect(seeds.map((seed) => seed.tier)).toEqual(['avenid', 'avenme', 'avenceo'])
		const byTier = Object.fromEntries(seeds.map((seed) => [seed.tier, seed]))
		expect(byTier.avenid?.interval).toBeNull()
		expect(byTier.avenme?.interval).toBe('month')
		expect(byTier.avenceo?.interval).toBe('month')
		// GROSS cents straight from the SSOT — tax-inclusive at the provider.
		expect(byTier.avenid?.priceCents).toBe(2500)
		expect(byTier.avenme?.priceCents).toBe(5500)
		expect(byTier.avenceo?.priceCents).toBe(37700)
	})
})

describe('standard webhooks', () => {
	it('signs and verifies a delivery round-trip', () => {
		const body = JSON.stringify({ type: 'order.paid', data: { id: 'ord_1' } })
		const headers = signWebhookHeaders(body, SECRET)
		expect(() => assertWebhookSignature(body, headers, SECRET)).not.toThrow()
	})

	it('rejects a tampered body with 403', () => {
		const body = JSON.stringify({ type: 'order.paid', data: { id: 'ord_1' } })
		const headers = signWebhookHeaders(body, SECRET)
		expect(
			thrownBy(() => assertWebhookSignature(body.replace('ord_1', 'ord_2'), headers, SECRET))
		).toMatchObject({ status: 403, code: 'WEBHOOK_SIGNATURE_INVALID' })
	})

	it('rejects a wrong secret and missing headers with 403', () => {
		const body = '{}'
		const headers = signWebhookHeaders(body, SECRET)
		expect(thrownBy(() => assertWebhookSignature(body, headers, 'another-secret'))).toMatchObject({
			status: 403,
			code: 'WEBHOOK_SIGNATURE_INVALID'
		})
		expect(
			thrownBy(() =>
				assertWebhookSignature(
					body,
					{ 'webhook-id': null, 'webhook-timestamp': null, 'webhook-signature': null },
					SECRET
				)
			)
		).toMatchObject({ status: 403, code: 'WEBHOOK_SIGNATURE_MISSING' })
	})
})

describe('polar wire parsers', () => {
	it('normalizes order.paid', () => {
		const event = parsePolarEvent(
			JSON.stringify({
				type: 'order.paid',
				data: {
					id: 'ord_1',
					checkout_id: 'ch_1',
					total_amount: 2500,
					currency: 'eur',
					customer: { id: 'cus_1', email: 'buyer@example.test' },
					metadata: { holdId: 'hold-1', name: 'daniel' }
				}
			})
		)
		expect(event).toEqual({
			id: 'ord_1',
			type: 'order.paid',
			checkoutId: 'ch_1',
			orderId: 'ord_1',
			email: 'buyer@example.test',
			amountEur: 25,
			metadata: { holdId: 'hold-1', name: 'daniel' }
		})
	})

	it('normalizes subscription events — tier from metadata, then the product', () => {
		const base = {
			id: 'sub_1',
			status: 'active',
			amount: 5500,
			current_period_end: '2026-09-24T00:00:00.000Z',
			cancel_at_period_end: false,
			customer: { id: 'cus_1', email: 'buyer@example.test', external_id: 'user-1' }
		}
		const fromMetadata = parsePolarSubscriptionEvent(
			JSON.stringify({
				type: 'subscription.active',
				data: { ...base, metadata: { userId: 'user-1', tier: 'avenme' } }
			})
		)
		expect(fromMetadata).toMatchObject({
			providerSubscriptionId: 'sub_1',
			providerCustomerId: 'cus_1',
			userId: 'user-1',
			tier: 'avenme',
			status: 'active',
			priceCents: 5500,
			cancelAtPeriodEnd: false
		})
		const fromProduct = parsePolarSubscriptionEvent(
			JSON.stringify({
				type: 'subscription.updated',
				data: { ...base, product: { id: 'prod_1', metadata: { tier: 'avenceo' } } }
			})
		)
		// No checkout metadata → the product's SSOT tag answers, and the
		// customer's external id (our user id) resolves the buyer.
		expect(fromProduct).toMatchObject({ tier: 'avenceo', userId: 'user-1' })
		expect(parsePolarSubscriptionEvent(JSON.stringify({ type: 'order.paid', data: {} }))).toBeNull()
	})

	it('unfolds customer.state_changed into one event per active subscription', () => {
		const events = parsePolarCustomerState(
			JSON.stringify({
				type: 'customer.state_changed',
				data: {
					id: 'cus_1',
					email: 'buyer@example.test',
					external_id: 'user-1',
					active_subscriptions: [
						{ id: 'sub_me', status: 'active', amount: 5500, cancel_at_period_end: false },
						{ id: 'sub_ceo', status: 'active', amount: 37700, cancel_at_period_end: true }
					]
				}
			})
		)
		expect(events).toHaveLength(2)
		expect(events[0]).toMatchObject({
			providerSubscriptionId: 'sub_me',
			providerCustomerId: 'cus_1',
			userId: 'user-1',
			tier: null,
			priceCents: 5500
		})
		expect(events[1]).toMatchObject({ providerSubscriptionId: 'sub_ceo', cancelAtPeriodEnd: true })
	})

	it('the fake provider produces deliveries the verifier accepts', () => {
		const provider = new FakePaymentProvider(testConfig())
		const body = provider.buildCompletedWebhookBody({
			checkoutId: 'ch_fake',
			holdId: 'hold-1',
			name: 'daniel',
			email: 'buyer@example.test',
			amountEur: 25
		})
		const event = provider.verifyWebhook(
			body,
			signWebhookHeaders(body, testConfig().POLAR_WEBHOOK_SECRET)
		)
		expect(event.type).toBe('order.paid')
		expect(event.checkoutId).toBe('ch_fake')
		expect(event.metadata).toEqual({ holdId: 'hold-1', name: 'daniel' })
		expect(event.amountEur).toBe(25)
	})
})
