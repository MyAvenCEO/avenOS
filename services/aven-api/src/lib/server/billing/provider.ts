// Payment boundary. Domain code (the names module) only ever sees this
// interface and the normalized PaymentEvent — never Creem payload shapes.
// Swap the provider (or add one) without touching the registry.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { AppError } from '../errors.js'

export interface CheckoutInput {
	name: string
	email: string
	holdId: string
	successUrl: string
}
export interface CheckoutSession {
	checkoutId: string
	checkoutUrl: string
}

export interface PaymentEvent {
	id: string
	type: 'checkout.completed' | 'refund.created' | 'dispute.created' | string
	checkoutId: string | null
	orderId: string | null
	email: string | null
	amountEur: number | null
	metadata: Record<string, unknown>
}

export interface PaymentProvider {
	readonly kind: 'creem' | 'fake'
	createCheckout(input: CheckoutInput): Promise<CheckoutSession>
	verifyWebhook(rawBody: string, signature: string | null): PaymentEvent
}

export function signWebhookPayload(rawBody: string, secret: string): string {
	return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function assertWebhookSignature(
	rawBody: string,
	signature: string | null,
	secret: string
): void {
	if (!signature)
		throw new AppError(400, 'WEBHOOK_SIGNATURE_MISSING', 'The webhook signature header is missing.')
	const expected = Buffer.from(signWebhookPayload(rawBody, secret), 'hex')
	const provided = Buffer.from(/^[0-9a-f]+$/i.test(signature) ? signature : '00', 'hex')
	if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
		throw new AppError(400, 'WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is invalid.')
	}
}

// Creem webhook envelope: { id, eventType, object } where object carries
// checkout/order/customer/metadata details depending on the event.
export function parseCreemEvent(rawBody: string): PaymentEvent {
	let payload: Record<string, any>
	try {
		payload = JSON.parse(rawBody) as Record<string, any>
	} catch {
		throw new AppError(400, 'WEBHOOK_PAYLOAD_INVALID', 'The webhook payload is not JSON.')
	}
	const object = (payload.object ?? {}) as Record<string, any>
	const order = (object.order ?? {}) as Record<string, any>
	const amountCents = Number(order.amount ?? object.amount ?? NaN)
	return {
		id: String(payload.id ?? ''),
		type: String(payload.eventType ?? payload.event_type ?? ''),
		checkoutId:
			object.checkout_id ??
			object.checkout?.id ??
			(String(payload.eventType ?? '').startsWith('checkout') ? (object.id ?? null) : null),
		orderId: order.id ?? object.order_id ?? null,
		email: object.customer?.email ?? order.customer?.email ?? null,
		amountEur: Number.isFinite(amountCents) ? amountCents / 100 : null,
		metadata: (object.metadata ?? {}) as Record<string, unknown>
	}
}
