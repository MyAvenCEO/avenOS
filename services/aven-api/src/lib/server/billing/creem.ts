import type { BillingConfig } from '../config.js'
import { AppError } from '../errors.js'
import {
	assertWebhookSignature,
	type CheckoutInput,
	type CheckoutSession,
	type PaymentEvent,
	type PaymentProvider,
	parseCreemEvent
} from './provider.js'

export class CreemProvider implements PaymentProvider {
	readonly kind = 'creem' as const
	constructor(private config: BillingConfig) {}

	private base(): string {
		if (this.config.CREEM_API_BASE) return this.config.CREEM_API_BASE.replace(/\/$/, '')
		return this.config.CREEM_API_KEY.startsWith('creem_test_')
			? 'https://test-api.creem.io'
			: 'https://api.creem.io'
	}

	async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
		const response = await fetch(`${this.base()}/v1/checkouts`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.CREEM_API_KEY },
			body: JSON.stringify({
				product_id: this.config.CREEM_PRODUCT_ID,
				request_id: input.holdId,
				success_url: input.successUrl,
				customer: { email: input.email },
				metadata: { holdId: input.holdId, name: input.name }
			})
		})
		if (!response.ok) {
			const detail = await response.text().catch(() => '')
			throw new AppError(
				502,
				'CHECKOUT_CREATE_FAILED',
				`The payment provider rejected the checkout (${response.status}).`,
				detail.slice(0, 300)
			)
		}
		const body = (await response.json()) as {
			id?: string
			checkoutUrl?: string
			checkout_url?: string
		}
		const checkoutUrl = body.checkoutUrl ?? body.checkout_url
		if (!body.id || !checkoutUrl)
			throw new AppError(
				502,
				'CHECKOUT_CREATE_FAILED',
				'The payment provider returned an incomplete checkout.'
			)
		return { checkoutId: body.id, checkoutUrl }
	}

	verifyWebhook(rawBody: string, signature: string | null): PaymentEvent {
		assertWebhookSignature(rawBody, signature, this.config.CREEM_WEBHOOK_SECRET)
		return parseCreemEvent(rawBody)
	}
}
