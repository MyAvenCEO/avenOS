import { describe, expect, test, vi } from 'vitest'
import { facadeConfigSchema } from '../src/config.js'
import { createFacadeHandler } from '../src/facade.js'

const customerSecrets = {
	CUSTOMER_ENTITLEMENT_TOKEN: 'e'.repeat(32),
	TENANT_GRANT_PRIVATE_KEY: 'test-private-key-material-'.repeat(5)
}
const config = facadeConfigSchema.parse({
	...customerSecrets,
	DATABASE_URL: 'postgres://aven_api:test@database/aven_api',
	SITE_HOST_DIRECTORY_BEARER_TOKEN: 'd'.repeat(32),
	IDENTITY_ISSUER: 'https://aven.id',
	DOWNSTREAMS_JSON: JSON.stringify([
		{ prefix: '/v1/runs', baseUrl: 'http://runner:8080', bearerToken: 's'.repeat(32) }
	])
})
const claims = {
	sub: '3f7b0f1e-7850-4902-a7b0-093f8604a0dd',
	sid: 'session-1',
	email: 'u@example.test',
	email_verified: true as const,
	role: 'user' as const,
	amr: ['passkey'] as Array<'passkey' | 'bootstrap'>,
	scope: 'openid services:access',
	iss: 'https://aven.id',
	aud: 'aven-services',
	exp: 2_000_000_000
}

describe('api facade', () => {
	test('fails closed before contacting a downstream', async () => {
		const fetcher = vi.fn(async (_request: Request) => new Response('{}'))
		const handler = createFacadeHandler(
			config,
			{
				verify: async () => {
					throw new Error('invalid')
				}
			},
			fetcher
		)
		const response = await handler(new Request('https://api.aven.ceo/v1/runs'))
		expect(response.status).toBe(401)
		expect(fetcher).not.toHaveBeenCalled()
	})
	test('replaces caller credentials with service credentials and verified identity headers', async () => {
		let forwarded: Request | undefined
		const handler = createFacadeHandler(config, { verify: async () => claims }, async (request) => {
			forwarded = request
			return new Response('{}')
		})
		const response = await handler(
			new Request('https://api.aven.ceo/v1/runs/abc?x=1', {
				headers: {
					authorization: 'Bearer user-jwt',
					cookie: 'secret=1',
					'x-aven-identity-token': 'forged'
				}
			})
		)
		expect(response.status).toBe(200)
		expect(forwarded?.url).toBe('http://runner:8080/abc?x=1')
		expect(forwarded?.headers.get('authorization')).toBe(`Bearer ${'s'.repeat(32)}`)
		expect(forwarded?.headers.get('x-aven-subject')).toBe(claims.sub)
		expect(forwarded?.headers.get('x-aven-identity-token')).toBe('user-jwt')
		expect(forwarded?.headers.has('cookie')).toBe(false)
	})
	test('enforces configured route roles after token verification', async () => {
		const adminConfig = facadeConfigSchema.parse({
			...customerSecrets,
			DATABASE_URL: 'postgres://aven_api:test@database/aven_api',
			SITE_HOST_DIRECTORY_BEARER_TOKEN: 'd'.repeat(32),
			IDENTITY_ISSUER: 'https://aven.id',
			DOWNSTREAMS_JSON: JSON.stringify([
				{
					prefix: '/v1/admin',
					baseUrl: 'http://admin:8080',
					bearerToken: 's'.repeat(32),
					roles: ['admin']
				}
			])
		})
		const fetcher = vi.fn(async (_request: Request) => new Response('{}'))
		const response = await createFacadeHandler(
			adminConfig,
			{ verify: async () => claims },
			fetcher
		)(
			new Request('https://api.aven.ceo/v1/admin', {
				headers: { authorization: 'Bearer user-jwt' }
			})
		)
		expect(response.status).toBe(403)
		expect(fetcher).not.toHaveBeenCalled()
	})
	test('does not become an open proxy', async () => {
		const response = await createFacadeHandler(config, { verify: async () => claims })(
			new Request('https://api.aven.ceo/http://evil.test', {
				headers: { authorization: 'Bearer user-jwt' }
			})
		)
		expect(response.status).toBe(404)
	})
})
