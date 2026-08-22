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

/** One recurring tier to guarantee exists at the provider. Prices are NET
 * cents — the provider (merchant of record) adds the buyer's VAT on top. */
export interface SubscriptionPlanSeed {
	tier: string
	name: string
	description: string
	priceCents: number
}

export interface SubscriptionCheckoutInput {
	productId: string
	tier: string
	userId: string
	email: string
	successUrl: string
}

/** One line in the customer's invoice history, already reduced to what the
 * pane shows. Creem's transactions API carries NO per-row receipt URL
 * (verified against the SDK's TransactionEntity) — the official invoice
 * documents live behind the hosted customer portal link instead. */
export interface InvoiceRow {
	id: string
	createdAt: string
	amountCents: number
	taxCents: number
	currency: string
	status: string
	periodStart: string | null
	periodEnd: string | null
}

/** One order, reduced to what the pane shows. Creem (merchant of record)
 * mails the official invoice for it — the API carries no document, so the
 * pane says where the invoice went instead of linking out. */
export interface OrderRow {
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

export interface PaymentProvider {
	readonly kind: 'creem' | 'fake'
	createCheckout(input: CheckoutInput): Promise<CheckoutSession>
	verifyWebhook(rawBody: string, signature: string | null): PaymentEvent
	/** Idempotent: finds products by `metadata.tier`, creates the missing
	 * ones, returns tier → provider product id. */
	ensureSubscriptionProducts(seeds: SubscriptionPlanSeed[]): Promise<Record<string, string>>
	createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession>
	/** Change to another tier's product; proration is charged immediately. */
	changeSubscription(providerSubscriptionId: string, productId: string): Promise<void>
	cancelSubscription(providerSubscriptionId: string, immediate: boolean): Promise<void>
	resumeSubscription(providerSubscriptionId: string): Promise<void>
	listInvoices(providerCustomerId: string): Promise<InvoiceRow[]>
	/** Look up the provider's customer for an email; null when none exists. */
	findCustomerByEmail(email: string): Promise<string | null>
	/** The customer's orders — the real "Meine Bestellungen". */
	listOrders(providerCustomerId: string): Promise<OrderRow[]>
	pauseSubscription(providerSubscriptionId: string): Promise<void>
	/** Where a checkout stands: pending | processing | completed | expired. */
	checkoutStatus(providerCheckoutId: string): Promise<string>
}

/** The normalized shape of a `subscription.*` webhook. Field names on the
 * wire vary (snake/camel, nested product vs product_id) — this parser is the
 * only place that knows; everything downstream sees this. */
export interface SubscriptionEvent {
	id: string
	type: string
	providerSubscriptionId: string
	providerCustomerId: string | null
	email: string | null
	userId: string | null
	tier: string | null
	status: string
	currentPeriodEnd: string | null
	cancelAtPeriodEnd: boolean
	priceCents: number | null
}

export function parseCreemSubscriptionEvent(rawBody: string): SubscriptionEvent | null {
	let payload: Record<string, any>
	try {
		payload = JSON.parse(rawBody) as Record<string, any>
	} catch {
		throw new AppError(400, 'WEBHOOK_PAYLOAD_INVALID', 'The webhook payload is not JSON.')
	}
	const type = String(payload.eventType ?? payload.event_type ?? '')
	if (!type.startsWith('subscription.')) return null
	const object = (payload.object ?? {}) as Record<string, any>
	const product = (object.product ?? {}) as Record<string, any>
	const customer = (object.customer ?? {}) as Record<string, any>
	const metadata = (object.metadata ?? {}) as Record<string, unknown>
	const priceCents = Number(product.price ?? object.amount ?? NaN)
	const subscriptionId = String(object.id ?? '')
	if (!subscriptionId) return null
	return {
		id: String(payload.id ?? ''),
		type,
		providerSubscriptionId: subscriptionId,
		providerCustomerId:
			typeof customer === 'string' ? customer : (customer.id ?? object.customer_id ?? null),
		email: typeof customer === 'object' ? (customer.email ?? null) : null,
		userId: typeof metadata.userId === 'string' ? metadata.userId : null,
		tier:
			typeof metadata.tier === 'string'
				? metadata.tier
				: typeof (product.metadata as Record<string, unknown> | undefined)?.tier === 'string'
					? String((product.metadata as Record<string, unknown>).tier)
					: null,
		status: String(object.status ?? ''),
		currentPeriodEnd:
			object.current_period_end_date ??
			object.currentPeriodEndDate ??
			object.current_period_end ??
			null,
		cancelAtPeriodEnd:
			object.status === 'scheduled_cancel' ||
			Boolean(object.canceled_at ?? object.cancel_at_period_end),
		priceCents: Number.isFinite(priceCents) ? priceCents : null
	}
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
