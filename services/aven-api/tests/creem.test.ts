import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreemProvider } from '../src/lib/server/billing/creem.js'

describe('CreemProvider', () => {
	afterEach(() => vi.unstubAllGlobals())

	it("uses Creem's snake_case checkout request contract", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					id: 'ch_test',
					checkout_url: 'https://checkout.creem.io/ch_test'
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		)
		vi.stubGlobal('fetch', fetchMock)

		const provider = new CreemProvider({
			PUBLIC_BASE_URL: 'https://id.aven.ceo',
			CREEM_API_KEY: 'creem_test_example',
			CREEM_API_BASE: '',
			CREEM_PRODUCT_AVENME: '',
			CREEM_PRODUCT_AVENCEO: '',
			CREEM_PRODUCT_ID: 'prod_example',
			CREEM_WEBHOOK_SECRET: 'webhook-secret'
		})

		const checkout = await provider.createCheckout({
			name: 'daniel',
			email: 'buyer@example.com',
			holdId: 'hold-1',
			successUrl: 'https://id.aven.ceo/purchase/success?pt=secret'
		})

		expect(checkout).toEqual({
			checkoutId: 'ch_test',
			checkoutUrl: 'https://checkout.creem.io/ch_test'
		})
		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://test-api.creem.io/v1/checkouts')
		expect(JSON.parse(String(init.body))).toEqual({
			product_id: 'prod_example',
			request_id: 'hold-1',
			success_url: 'https://id.aven.ceo/purchase/success?pt=secret',
			customer: { email: 'buyer@example.com' },
			metadata: { holdId: 'hold-1', name: 'daniel' }
		})
	})
})
