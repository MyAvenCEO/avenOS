// Local stand-in for Creem when no API key is configured: the "checkout" is a
// page served by this app, and paying there posts a correctly signed,
// Creem-shaped webhook back to our own webhook endpoint — so development and
// e2e exercise the identical grant path as production.
import { randomUUID } from 'node:crypto'
import type { BillingConfig } from '../config.js'
import { CreemProvider } from './creem.js'
import {
	assertWebhookSignature,
	type CheckoutInput,
	type CheckoutSession,
	type InvoiceRow,
	type PaymentEvent,
	type PaymentProvider,
	parseCreemEvent,
	type SubscriptionCheckoutInput,
	type SubscriptionPlanSeed
} from './provider.js'

export class FakePaymentProvider implements PaymentProvider {
	readonly kind = 'fake' as const
	constructor(private config: BillingConfig) {}

	async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
		const checkoutId = `fake_${randomUUID()}`
		const url = new URL('/purchase/fake-checkout', this.config.PUBLIC_BASE_URL)
		url.searchParams.set('checkoutId', checkoutId)
		url.searchParams.set('holdId', input.holdId)
		url.searchParams.set('name', input.name)
		url.searchParams.set('email', input.email)
		url.searchParams.set('successUrl', input.successUrl)
		return { checkoutId, checkoutUrl: url.toString() }
	}

	verifyWebhook(rawBody: string, signature: string | null): PaymentEvent {
		assertWebhookSignature(rawBody, signature, this.config.CREEM_WEBHOOK_SECRET)
		return parseCreemEvent(rawBody)
	}

	// The subscription surface in fake mode is deterministic and local: stable
	// per-tier product ids, a checkout URL on our own fake page, and actions
	// that succeed silently — state still only ever changes via the webhook,
	// exactly like production.
	async ensureSubscriptionProducts(seeds: SubscriptionPlanSeed[]): Promise<Record<string, string>> {
		return Object.fromEntries(seeds.map((seed) => [seed.tier, `fake_prod_${seed.tier}`]))
	}

	async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
		const checkoutId = `fake_${randomUUID()}`
		const url = new URL('/purchase/fake-checkout', this.config.PUBLIC_BASE_URL)
		url.searchParams.set('checkoutId', checkoutId)
		url.searchParams.set('tier', input.tier)
		url.searchParams.set('userId', input.userId)
		url.searchParams.set('email', input.email)
		url.searchParams.set('successUrl', input.successUrl)
		return { checkoutId, checkoutUrl: url.toString() }
	}

	async changeSubscription(): Promise<void> {}
	async cancelSubscription(): Promise<void> {}
	async resumeSubscription(): Promise<void> {}
	async listInvoices(): Promise<InvoiceRow[]> {
		return []
	}

	async customerPortalUrl(): Promise<string> {
		return new URL('/purchase/fake-checkout', this.config.PUBLIC_BASE_URL).toString()
	}

	buildCompletedWebhookBody(input: {
		checkoutId: string
		holdId: string
		name: string
		email: string
		amountEur: number
	}): string {
		return JSON.stringify({
			id: `evt_fake_${randomUUID()}`,
			eventType: 'checkout.completed',
			object: {
				id: input.checkoutId,
				order: {
					id: `ord_fake_${randomUUID()}`,
					amount: Math.round(input.amountEur * 100),
					customer: { email: input.email }
				},
				customer: { email: input.email },
				metadata: { holdId: input.holdId, name: input.name }
			}
		})
	}
}

export function createPaymentProvider(config: BillingConfig): PaymentProvider {
	return config.CREEM_API_KEY ? new CreemProvider(config) : new FakePaymentProvider(config)
}
