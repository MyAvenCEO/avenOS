import type { BillingConfig } from '../config.js'
import { AppError } from '../errors.js'
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

	/** One place for every authenticated Creem call: the x-api-key header
	 * never leaves this module, and error surfaces read the same. */
	private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await fetch(`${this.base()}${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.CREEM_API_KEY },
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		})
		if (!response.ok) {
			const detail = await response.text().catch(() => '')
			throw new AppError(
				502,
				'BILLING_PROVIDER_ERROR',
				`The payment provider rejected ${method} ${path} (${response.status}).`,
				detail.slice(0, 300)
			)
		}
		return (await response.json()) as T
	}

	async ensureSubscriptionProducts(seeds: SubscriptionPlanSeed[]): Promise<Record<string, string>> {
		// Creem's create-product API accepts NO metadata (a metadata field is
		// rejected with a 400 — learned the hard way), so tier-tagging at the
		// provider is impossible. Resolution order instead: (1) product ids
		// pinned in config (dashboard-created products), (2) an existing
		// product whose NAME matches the plan, (3) create it.
		const pinned: Record<string, string | undefined> = {
			avenme: this.config.CREEM_PRODUCT_AVENME || undefined,
			avenceo: this.config.CREEM_PRODUCT_AVENCEO || undefined
		}
		const map: Record<string, string> = {}
		let existing: Array<Record<string, any>> | null = null
		for (const seed of seeds) {
			const pin = pinned[seed.tier]
			if (pin) {
				map[seed.tier] = pin
				continue
			}
			if (existing === null) {
				const found = await this.api<{ items?: Array<Record<string, any>> }>(
					'GET',
					'/v1/products/search?page_size=100'
				)
				existing = found.items ?? []
			}
			const named = existing.find((product) => product.name === seed.name && product.id)
			if (named) {
				map[seed.tier] = String(named.id)
				continue
			}
			const created = await this.api<{ id: string }>('POST', '/v1/products', {
				name: seed.name,
				description: seed.description,
				// NET cents: the site says "zzgl. USt." and Creem, as merchant of
				// record, adds the buyer's VAT on top of an exclusive price.
				price: seed.priceCents,
				currency: 'EUR',
				billing_type: 'recurring',
				billing_period: 'every-month',
				tax_mode: 'exclusive',
				tax_category: 'saas'
			})
			map[seed.tier] = created.id
		}
		return map
	}

	/** The provider's customer record for an email, if one exists — how a
	 * member who bought BEFORE we started storing customer ids (the one-off
	 * avenID) gets their history connected. */
	async findCustomerByEmail(email: string): Promise<string | null> {
		try {
			const result = await this.api<{ id?: string }>(
				'GET',
				`/v1/customers?email=${encodeURIComponent(email)}`
			)
			return result.id ?? null
		} catch {
			// 404 = no such customer; treated as absence, not failure.
			return null
		}
	}

	async createSubscriptionCheckout(input: SubscriptionCheckoutInput): Promise<CheckoutSession> {
		const body = await this.api<{ id?: string; checkoutUrl?: string; checkout_url?: string }>(
			'POST',
			'/v1/checkouts',
			{
				product_id: input.productId,
				success_url: input.successUrl,
				customer: { email: input.email },
				metadata: { userId: input.userId, tier: input.tier }
			}
		)
		const checkoutUrl = body.checkoutUrl ?? body.checkout_url
		if (!body.id || !checkoutUrl)
			throw new AppError(
				502,
				'CHECKOUT_CREATE_FAILED',
				'The payment provider returned an incomplete checkout.'
			)
		return { checkoutId: body.id, checkoutUrl }
	}

	async changeSubscription(providerSubscriptionId: string, productId: string): Promise<void> {
		await this.api('POST', `/v1/subscriptions/${providerSubscriptionId}/upgrade`, {
			product_id: productId,
			update_behavior: 'proration-charge-immediately'
		})
	}

	async cancelSubscription(providerSubscriptionId: string, immediate: boolean): Promise<void> {
		await this.api('POST', `/v1/subscriptions/${providerSubscriptionId}/cancel`, {
			// German Kündigungsbutton semantics: the default keeps access until
			// the period the member already paid for runs out.
			mode: immediate ? 'immediately' : 'scheduled_cancel'
		})
	}

	async resumeSubscription(providerSubscriptionId: string): Promise<void> {
		await this.api('POST', `/v1/subscriptions/${providerSubscriptionId}/resume`, {})
	}

	async listInvoices(providerCustomerId: string): Promise<InvoiceRow[]> {
		const result = await this.api<{ items?: Array<Record<string, any>> }>(
			'GET',
			`/v1/transactions/search?customer_id=${encodeURIComponent(providerCustomerId)}&page_size=100`
		)
		return (result.items ?? []).map((tx) => ({
			id: String(tx.id ?? ''),
			// Creem sends created_at as a unix-ms timestamp on transactions.
			createdAt: new Date(Number(tx.created_at ?? tx.createdAt ?? 0)).toISOString(),
			amountCents: Number(tx.amount ?? 0),
			taxCents: Number(tx.tax_amount ?? tx.taxAmount ?? 0),
			currency: String(tx.currency ?? 'EUR'),
			status: String(tx.status ?? ''),
			periodStart: tx.period_start ? new Date(Number(tx.period_start)).toISOString() : null,
			periodEnd: tx.period_end ? new Date(Number(tx.period_end)).toISOString() : null
		}))
	}

	async customerPortalUrl(providerCustomerId: string): Promise<string> {
		const result = await this.api<{ customer_portal_link?: string; customerPortalLink?: string }>(
			'POST',
			'/v1/customers/billing',
			{ customer_id: providerCustomerId }
		)
		const url = result.customer_portal_link ?? result.customerPortalLink
		if (!url)
			throw new AppError(502, 'BILLING_PROVIDER_ERROR', 'No customer portal link was returned.')
		return url
	}

	verifyWebhook(rawBody: string, signature: string | null): PaymentEvent {
		assertWebhookSignature(rawBody, signature, this.config.CREEM_WEBHOOK_SECRET)
		return parseCreemEvent(rawBody)
	}
}
