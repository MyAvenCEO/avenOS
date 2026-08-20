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
	type PaymentEvent,
	type PaymentProvider,
	parseCreemEvent
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
