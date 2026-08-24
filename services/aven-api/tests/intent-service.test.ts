import { describe, expect, test } from 'vitest'
import { IntentService } from '../src/lib/server/intents/service'

const scopeId = '11111111-1111-4111-8111-111111111111'
const intentId = '22222222-2222-4222-8222-222222222222'

function configured(fetch: typeof globalThis.fetch) {
	return IntentService.fromConfig(
		{
			INTENT_SERVICE_BASE_URL: 'http://intent-service.test/',
			INTENT_SERVICE_BEARER_TOKEN: 'intent-service-token'
		},
		fetch
	)
}

describe('Intent Service client', () => {
	test('authenticates, binds the tenant route, and forwards a lifecycle command', async () => {
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			expect(request.url).toBe(
				`http://intent-service.test/v1/scopes/${scopeId}/intents/${intentId}/archive`
			)
			expect(request.method).toBe('POST')
			expect(request.headers.get('authorization')).toBe('Bearer intent-service-token')
			expect(request.headers.get('x-aven-artifact-database')).toBe('cust_test')
			expect(request.headers.get('content-type')).toBe('application/json')
			expect(await request.json()).toEqual({ id: intentId, expectedVersion: 7 })
			return Response.json({ id: intentId, version: 8, state: 'archive' })
		}
		const service = configured(fetch)

		await expect(
			service?.lifecycle('cust_test', scopeId, intentId, 'archive', {
				id: intentId,
				expectedVersion: 7
			})
		).resolves.toMatchObject({ id: intentId, version: 8, state: 'archive' })
	})

	test.each([
		[400, 400, 'INTENT_INPUT_INVALID'],
		[422, 400, 'INTENT_INPUT_INVALID'],
		[404, 404, 'INTENT_NOT_FOUND'],
		[409, 409, 'INTENT_VERSION_CONFLICT'],
		[500, 502, 'INTENT_SERVICE_UNAVAILABLE']
	])('maps service HTTP %i to stable API error %s', async (upstream, status, code) => {
		const service = configured(async () => new Response('rejected', { status: upstream }))
		await expect(service?.detail('cust_test', scopeId, intentId)).rejects.toMatchObject({
			status,
			code
		})
	})

	test('accepts an empty successful delete response', async () => {
		const service = configured(async () => new Response(null, { status: 204 }))
		await expect(
			service?.delete('cust_test', scopeId, intentId, { id: intentId, expectedVersion: 3 })
		).resolves.toBeNull()
	})
})
