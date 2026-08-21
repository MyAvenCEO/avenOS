import { describe, expect, it } from 'vitest'
import { designerApi, designerCheckout, designerPages } from '../src/lib/designer.js'
import type { MetaInfo, NameAvailability, NameHoldResult, PasskeyStatus } from '../src/lib/types.js'

describe('designer build fixtures', () => {
	it('links to every UI route with the required sample parameters', () => {
		expect(designerPages.map(({ path }) => path)).toEqual([
			'/',
			'/secure',
			'/login',
			'/device',
			'/passkey/create',
			'/dashboard',
			'/purchase/checkout',
			'/purchase/fake-checkout',
			'/purchase/success',
			'/purchase/expired'
		])
		expect(designerCheckout).toMatchObject({ name: 'aurora', provider: 'fake', priceEur: 25 })
	})

	it('serves the API data needed by interactive pages without a backend', async () => {
		await expect(designerApi<NameAvailability>('/names/check?name=aurora')).resolves.toMatchObject({
			name: 'aurora',
			available: true,
			priceEur: 25
		})
		await expect(
			designerApi<{ hold: NameHoldResult }>('/names/hold', {
				method: 'POST',
				body: JSON.stringify({ name: 'aurora', email: 'alex@example.com' })
			})
		).resolves.toMatchObject({ hold: { name: 'aurora', priceEur: 25 } })
		await expect(designerApi<PasskeyStatus>('/passkeys')).resolves.toMatchObject({
			passkeys: [{ prf_enabled: true }]
		})
		await expect(designerApi<MetaInfo>('/meta')).resolves.toMatchObject({
			downloadUrl: '#designer-download'
		})
	})
})
