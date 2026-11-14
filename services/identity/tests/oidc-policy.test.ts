import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { safeReturnPath } from '../src/lib/return-path.js'
import { identityConfigSchema } from '../src/lib/server/config.js'
import type { Queryable } from '../src/lib/server/db.js'
import {
	carriesPluginResume,
	configuredOidcClients,
	idTokenClaims,
	isClosedPluginPath,
	isRegisteredInsecureRedirect,
	oidcClientDiscovery,
	oidcGate
} from '../src/lib/server/oidc.js'

const base = {
	PUBLIC_BASE_URL: 'https://aven.id',
	WEBAUTHN_RP_ID: 'aven.id',
	DATABASE_URL: 'postgres://identity_auth:test@db/identity',
	BETTER_AUTH_SECRET: 'b'.repeat(32),
	IDENTITY_PROVISIONING_SECRETS: 'p'.repeat(32)
}
const client = {
	client_id: 'coordinator',
	name: 'Coordinator',
	redirect_uris: ['https://coordinator.example.test/auth/callback']
}
const clients = (value: unknown, extra: Record<string, string> = {}) =>
	identityConfigSchema.safeParse({ ...base, ...extra, OIDC_CLIENTS: JSON.stringify(value) })

describe('OIDC_CLIENTS configuration', () => {
	test('defaults to no clients and parses a registered public client', () => {
		expect(identityConfigSchema.parse(base).OIDC_CLIENTS).toEqual([])
		expect(identityConfigSchema.parse({ ...base, OIDC_CLIENTS: '' }).OIDC_CLIENTS).toEqual([])
		expect(clients([client]).data?.OIDC_CLIENTS).toEqual([client])
	})

	test('rejects malformed JSON, unknown fields and secrets', () => {
		expect(identityConfigSchema.safeParse({ ...base, OIDC_CLIENTS: '[{' }).success).toBe(false)
		expect(clients({ ...client }).success).toBe(false)
		expect(clients([{ ...client, client_secret: 'x'.repeat(32) }]).success).toBe(false)
		expect(clients([{ ...client, redirect_uris: [] }]).success).toBe(false)
		expect(clients([{ ...client, client_id: '' }]).success).toBe(false)
		expect(clients([{ ...client, client_id: 'has space' }]).success).toBe(false)
		expect(clients([{ ...client, name: 'bad\nname' }]).success).toBe(false)
	})

	test('rejects duplicate clients, duplicate URIs and the native device client id', () => {
		expect(clients([client, client]).success).toBe(false)
		expect(clients([{ ...client, client_id: 'ceo.aven.os' }]).success).toBe(false)
		expect(
			clients([{ ...client, redirect_uris: [client.redirect_uris[0], client.redirect_uris[0]] }])
				.success
		).toBe(false)
	})

	test('requires HTTPS, canonical, fragment- and credential-free redirect URIs', () => {
		for (const uri of [
			'http://coordinator.example.test/cb',
			'javascript:alert(1)',
			'/relative/callback',
			'https://coordinator.example.test/cb#fragment',
			'https://user:pass@coordinator.example.test/cb',
			'https://Coordinator.example.test/cb',
			'https://coordinator.example.test',
			'https://coordinator.example.test:443/cb'
		])
			expect(clients([{ ...client, redirect_uris: [uri] }]).success, uri).toBe(false)
	})

	test('allows loopback HTTP only outside production', () => {
		const loopback = [{ ...client, redirect_uris: ['http://localhost:4000/auth/callback'] }]
		const ipv4 = [{ ...client, redirect_uris: ['http://127.0.0.1:4000/auth/callback'] }]
		expect(clients(loopback).success).toBe(true)
		expect(clients(ipv4).success).toBe(true)
		const production = {
			NODE_ENV: 'production',
			ACCOUNTS_DATABASE_URL: 'postgres://identity_accounts:test@db/identity',
			AUTHORIZATION_DATABASE_URL: 'postgres://identity_authorization:test@db/identity',
			IDENTITY_MAIL_ORIGINS: 'https://portal.aven.ceo'
		}
		expect(clients([client], production).success).toBe(true)
		const failure = clients(loopback, production)
		expect(failure.success).toBe(false)
		expect(failure.error?.issues[0]?.path).toEqual(['OIDC_CLIENTS', 0, 'redirect_uris', 0])
		expect(clients(ipv4, production).success).toBe(false)
	})
})

describe('login return path', () => {
	const origin = 'https://aven.id'
	test('returns only to a same-origin authorization request', () => {
		expect(safeReturnPath('/api/auth/oauth2/authorize?client_id=a&state=b', origin)).toBe(
			'/api/auth/oauth2/authorize?client_id=a&state=b'
		)
		for (const value of [
			null,
			'',
			'https://evil.example/api/auth/oauth2/authorize',
			'//evil.example/api/auth/oauth2/authorize',
			'/\\evil.example/api/auth/oauth2/authorize',
			'/api/auth/oauth2/authorize\n',
			'/dashboard',
			'/api/auth/oauth2/authorize/../../../evil',
			'/api/auth/token',
			'javascript:alert(1)',
			'/api/auth/oauth2/authorize#x'
		])
			expect(safeReturnPath(value, origin), String(value)).toBeNull()
	})
})

describe('OIDC request gate', () => {
	const config = identityConfigSchema.parse({ ...base, OIDC_CLIENTS: JSON.stringify([client]) })
	const verifier = 'v'.repeat(64)
	const challenge = createHash('sha256').update(verifier).digest('base64url')
	const valid = {
		response_type: 'code',
		client_id: client.client_id,
		redirect_uri: client.redirect_uris[0],
		scope: 'openid email',
		state: 'state-1',
		nonce: 'nonce-1',
		code_challenge: challenge,
		code_challenge_method: 'S256'
	}
	const session = { session: { id: 's1', createdAt: new Date() }, user: { id: 'u1' } }
	const pool = (passkey: boolean) =>
		({ query: async () => ({ rows: passkey ? [{}] : [] }) }) as unknown as Queryable
	async function authorize(
		params: Record<string, string | undefined>,
		options: { session?: typeof session | null; passkey?: boolean } = {}
	) {
		const url = new URL('https://aven.id/api/auth/oauth2/authorize')
		for (const [key, value] of Object.entries(params))
			if (value !== undefined) url.searchParams.set(key, value)
		return oidcGate({
			request: new Request(url),
			config,
			pool: pool(options.passkey ?? true),
			getSession: async () => (options.session === undefined ? session : options.session)
		})
	}
	const location = (result: Request | Response) => {
		expect(result).toBeInstanceOf(Response)
		expect((result as Response).status).toBe(302)
		return new URL((result as Response).headers.get('location')!, 'https://aven.id')
	}

	test('forwards a valid passkey-session request without prompt or max_age', async () => {
		const result = await authorize({ ...valid, prompt: 'consent', max_age: '3600' })
		expect(result).toBeInstanceOf(Request)
		const forwarded = new URL((result as Request).url)
		expect(forwarded.searchParams.get('prompt')).toBeNull()
		expect(forwarded.searchParams.get('max_age')).toBeNull()
		expect(forwarded.searchParams.get('code_challenge')).toBe(challenge)
	})

	test('forwards only the standard code-flow parameters to the plugin', async () => {
		const result = await authorize({
			...valid,
			claims: JSON.stringify({ userinfo: { email: null } }),
			resource: 'https://api.example.test',
			dpop_jkt: 'thumbprint',
			acr_values: '0',
			login_hint: 'ada@example.test',
			ui_locales: 'de',
			display: 'popup',
			id_token_hint: 'x.y.z',
			response_mode: 'query'
		})
		expect(result).toBeInstanceOf(Request)
		const forwarded = new URL((result as Request).url)
		expect(forwarded.pathname).toBe('/api/auth/oauth2/authorize')
		expect([...forwarded.searchParams.keys()].sort()).toEqual(Object.keys(valid).sort())
		for (const [key, value] of Object.entries(valid))
			expect(forwarded.searchParams.get(key)).toBe(value)
	})

	test('refuses POST authorization requests, repeated parameters and prompt=create', async () => {
		const url = new URL('https://aven.id/api/auth/oauth2/authorize')
		const post = (await oidcGate({
			request: new Request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams(valid)
			}),
			config,
			pool: pool(true),
			getSession: async () => session
		})) as Response
		expect(post.status).toBe(405)
		const repeated = new URL(url)
		for (const [key, value] of Object.entries(valid)) repeated.searchParams.append(key, value)
		repeated.searchParams.append('scope', 'openid')
		const twice = (await oidcGate({
			request: new Request(repeated),
			config,
			pool: pool(true),
			getSession: async () => session
		})) as Response
		expect(twice.status).toBe(400)
		const create = location(await authorize({ ...valid, prompt: 'create' }))
		expect(create.searchParams.get('error')).toBe('invalid_request')
	})

	test('refuses unknown clients and unregistered redirect URIs without redirecting', async () => {
		for (const params of [
			{ ...valid, client_id: 'unknown' },
			{ ...valid, redirect_uri: 'https://evil.example/cb' },
			{ ...valid, redirect_uri: `${client.redirect_uris[0]}?x=1` },
			{ ...valid, redirect_uri: undefined }
		]) {
			const result = (await authorize(params)) as Response
			expect(result.status).toBe(400)
			expect(result.headers.get('location')).toBeNull()
		}
	})

	test('refuses missing or plain PKCE, other scopes and non-code responses at the client', async () => {
		for (const [params, error] of [
			[
				{ ...valid, code_challenge: undefined, code_challenge_method: undefined },
				'invalid_request'
			],
			[{ ...valid, code_challenge_method: undefined }, 'invalid_request'],
			[{ ...valid, code_challenge_method: 'plain', code_challenge: verifier }, 'invalid_request'],
			[{ ...valid, code_challenge: 'short' }, 'invalid_request'],
			[{ ...valid, scope: 'openid offline_access' }, 'invalid_scope'],
			[{ ...valid, scope: 'email' }, 'invalid_scope'],
			[{ ...valid, response_type: 'token' }, 'unsupported_response_type'],
			[{ ...valid, state: undefined }, 'invalid_request'],
			[{ ...valid, prompt: 'none login' }, 'invalid_request']
		] as const) {
			const target = location(await authorize(params))
			expect(`${target.origin}${target.pathname}`).toBe(client.redirect_uris[0])
			expect(target.searchParams.get('error'), JSON.stringify(params)).toBe(error)
			expect(target.searchParams.get('code')).toBeNull()
		}
	})

	test('sends a signed-out browser through /login and back to the same request', async () => {
		const target = location(await authorize({ ...valid, prompt: 'login' }, { session: null }))
		expect(target.pathname).toBe('/login')
		const back = safeReturnPath(target.searchParams.get('returnTo'), 'https://aven.id')
		expect(back).not.toBeNull()
		const resumed = new URL(back!, 'https://aven.id')
		expect(resumed.pathname).toBe('/api/auth/oauth2/authorize')
		expect(resumed.searchParams.get('state')).toBe('state-1')
		expect(resumed.searchParams.get('prompt')).toBeNull()
	})

	test('re-authenticates for prompt=login and an exceeded max_age', async () => {
		expect(location(await authorize({ ...valid, prompt: 'login' })).pathname).toBe('/login')
		const old = { ...session, session: { id: 's1', createdAt: new Date(Date.now() - 120_000) } }
		expect(location(await authorize({ ...valid, max_age: '60' }, { session: old })).pathname).toBe(
			'/login'
		)
		expect(await authorize({ ...valid, max_age: '600' }, { session: old })).toBeInstanceOf(Request)
	})

	test('a bootstrap session never reaches the plugin', async () => {
		expect(location(await authorize(valid, { passkey: false })).pathname).toBe('/dashboard')
		const none = location(await authorize({ ...valid, prompt: 'none' }, { passkey: false }))
		expect(none.searchParams.get('error')).toBe('login_required')
		const signedOut = location(await authorize({ ...valid, prompt: 'none' }, { session: null }))
		expect(signedOut.searchParams.get('error')).toBe('login_required')
	})

	async function token(body: Record<string, string>, headers: Record<string, string> = {}) {
		return oidcGate({
			request: new Request('https://aven.id/api/auth/oauth2/token', {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
				body: new URLSearchParams(body)
			}),
			config,
			pool: pool(true),
			getSession: async () => null
		})
	}
	const exchange = {
		grant_type: 'authorization_code',
		client_id: client.client_id,
		code: 'code',
		redirect_uri: client.redirect_uris[0],
		code_verifier: verifier
	}

	test('token requests are public PKCE authorization-code exchanges only', async () => {
		expect(await token(exchange)).toBeInstanceOf(Request)
		for (const [body, headers, error] of [
			[
				{ ...exchange, grant_type: 'refresh_token', refresh_token: 'x' },
				{},
				'unsupported_grant_type'
			],
			[{ ...exchange, grant_type: 'client_credentials' }, {}, 'unsupported_grant_type'],
			[
				{ ...exchange, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
				{},
				'unsupported_grant_type'
			],
			[{ ...exchange, client_id: 'unknown' }, {}, 'invalid_client'],
			[{ ...exchange, client_secret: 'secret' }, {}, 'invalid_client'],
			[{ ...exchange, client_assertion: 'x.y.z' }, {}, 'invalid_client'],
			[
				{
					...exchange,
					client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
				},
				{},
				'invalid_client'
			],
			[exchange, { authorization: `Basic ${btoa('coordinator:secret')}` }, 'invalid_client'],
			[exchange, { dpop: 'x.y.z' }, 'invalid_request'],
			[{ ...exchange, resource: 'https://api.example.test' }, {}, 'invalid_target'],
			[{ ...exchange, code_verifier: 'short' }, {}, 'invalid_request'],
			[{ ...exchange, code_verifier: '' }, {}, 'invalid_request']
		] as const) {
			const result = (await token(body, headers)) as Response
			expect(result).toBeInstanceOf(Response)
			expect((await result.json()).error, JSON.stringify(body)).toBe(error)
		}
		const json = (await oidcGate({
			request: new Request('https://aven.id/api/auth/oauth2/token', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(exchange)
			}),
			config,
			pool: pool(true),
			getSession: async () => null
		})) as Response
		expect(json.status).toBe(400)
	})

	test('closes every plugin endpoint except authorize, token and userinfo', async () => {
		const closed = [
			'/api/auth/oauth2/register',
			'/api/auth/oauth2/consent',
			'/api/auth/oauth2/continue',
			'/api/auth/oauth2/introspect',
			'/api/auth/oauth2/revoke',
			'/api/auth/oauth2/end-session',
			'/api/auth/oauth2/end-session/confirm',
			'/api/auth/oauth2/create-client',
			'/api/auth/oauth2/get-client',
			'/api/auth/oauth2/get-clients',
			'/api/auth/oauth2/public-client',
			'/api/auth/oauth2/public-client-prelogin',
			'/api/auth/oauth2/update-client',
			'/api/auth/oauth2/delete-client',
			'/api/auth/oauth2/client/rotate-secret',
			'/api/auth/oauth2/client/rotate-keys',
			'/api/auth/oauth2/get-consent',
			'/api/auth/oauth2/get-consents',
			'/api/auth/oauth2/update-consent',
			'/api/auth/oauth2/delete-consent',
			'/api/auth/oauth2',
			'/api/auth/oauth2/',
			'/api/auth/admin/oauth2/create-client',
			'/api/auth/admin/oauth2/update-client',
			'/api/auth/admin/oauth2/resources',
			'/api/auth/admin/oauth2/resources/https%3A%2F%2Fapi/clients/coordinator',
			'/api/auth/.well-known/openid-configuration',
			'/api/auth/.well-known/oauth-authorization-server'
		]
		for (const path of closed)
			for (const method of ['GET', 'POST']) {
				const result = (await oidcGate({
					request: new Request(`https://aven.id${path}`, { method }),
					config,
					pool: pool(true),
					getSession: async () => session
				})) as Response
				expect(result.status, `${method} ${path}`).toBe(404)
			}
		for (const path of [
			'/api/auth/oauth2/authorize',
			'/api/auth/oauth2/token',
			'/api/auth/oauth2/userinfo',
			'/api/auth/jwks',
			'/api/auth/token',
			'/api/auth/device/approve'
		])
			expect(isClosedPluginPath(path), path).toBe(false)
	})

	test('recognises the plugin resume field in any parsed request body', () => {
		expect(carriesPluginResume({ oauth_query: 'client_id=a&sig=b' })).toBe(true)
		expect(carriesPluginResume({ oauth_query: '' })).toBe(true)
		expect(carriesPluginResume({ response: {} })).toBe(false)
		expect(carriesPluginResume('oauth_query=a')).toBe(false)
		expect(carriesPluginResume(undefined)).toBe(false)
	})
})

describe('OIDC client records', () => {
	const config = identityConfigSchema.parse({ ...base, OIDC_CLIENTS: JSON.stringify([client]) })

	test('serves configured clients as public, PKCE-only, consent-free code clients', async () => {
		const [record] = configuredOidcClients(config)
		expect(record).toMatchObject({
			clientId: client.client_id,
			redirectUris: client.redirect_uris,
			tokenEndpointAuthMethod: 'none',
			grantTypes: ['authorization_code'],
			responseTypes: ['code'],
			scopes: ['openid', 'profile', 'email'],
			applicationType: 'web',
			requirePKCE: true,
			skipConsent: true,
			enableEndSession: false,
			disabled: false
		})
		expect(record.clientSecret).toBeUndefined()
		expect(record.backchannelLogoutUri).toBeUndefined()
		const discovery = oidcClientDiscovery(config).clientDiscovery
		if (!discovery || Array.isArray(discovery)) throw new Error('one discovery expected')
		expect(discovery.matches(client.client_id)).toBe(true)
		expect(discovery.matches('unknown')).toBe(false)
		expect(discovery.matches('ceo.aven.os')).toBe(false)
		const resolved = await discovery.resolve({} as never, client.client_id, null)
		expect(resolved).toEqual(record)
		// Each lookup gets a fresh copy, so the plugin cannot mutate the configured record.
		resolved!.redirectUris!.push('https://evil.example/cb')
		expect(await discovery.resolve({} as never, client.client_id, null)).toEqual(record)
		expect(await discovery.resolve({} as never, 'unknown', null)).toBeNull()
	})

	test('accepts plain-HTTP redirects only when registered and outside production', () => {
		const local = identityConfigSchema.parse({
			...base,
			OIDC_CLIENTS: JSON.stringify([
				{ ...client, redirect_uris: ['http://localhost:4000/auth/callback'] }
			])
		})
		expect(
			isRegisteredInsecureRedirect(local, new URL('http://localhost:4000/auth/callback'))
		).toBe(true)
		expect(
			isRegisteredInsecureRedirect(local, new URL('http://localhost:4001/auth/callback'))
		).toBe(false)
		expect(isRegisteredInsecureRedirect(local, new URL('http://localhost:4000/other'))).toBe(false)
		expect(
			isRegisteredInsecureRedirect(
				{ ...local, NODE_ENV: 'production' },
				new URL('http://localhost:4000/auth/callback')
			)
		).toBe(false)
	})

	test('ID-token profile and email claims follow the granted scopes', () => {
		const user = {
			name: 'Ada King Lovelace',
			email: 'ada@example.test',
			emailVerified: true,
			image: null,
			updatedAt: new Date('2026-01-01T00:00:00Z')
		}
		expect(idTokenClaims(user, ['openid'])).toEqual({})
		expect(idTokenClaims(user, ['openid', 'email'])).toEqual({
			email: 'ada@example.test',
			email_verified: true
		})
		expect(idTokenClaims(user, ['openid', 'profile'])).toEqual({
			name: 'Ada King Lovelace',
			picture: undefined,
			given_name: 'Ada King',
			family_name: 'Lovelace',
			updated_at: 1767225600
		})
	})
})

describe('discovery document', () => {
	test('advertises only the code + PKCE surface identity serves', async () => {
		for (const [key, value] of Object.entries(base)) vi.stubEnv(key, value)
		try {
			const { GET } = await import('../src/routes/.well-known/openid-configuration/+server.js')
			const document = await GET().json()
			expect(document).toMatchObject({
				issuer: 'https://aven.id',
				authorization_endpoint: 'https://aven.id/api/auth/oauth2/authorize',
				token_endpoint: 'https://aven.id/api/auth/oauth2/token',
				userinfo_endpoint: 'https://aven.id/api/auth/oauth2/userinfo',
				jwks_uri: 'https://aven.id/api/auth/jwks',
				aven_service_token_endpoint: 'https://aven.id/api/auth/token',
				scopes_supported: ['openid', 'profile', 'email'],
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code'],
				code_challenge_methods_supported: ['S256'],
				token_endpoint_auth_methods_supported: ['none'],
				id_token_signing_alg_values_supported: ['EdDSA']
			})
			for (const key of [
				'registration_endpoint',
				'introspection_endpoint',
				'revocation_endpoint',
				'end_session_endpoint'
			])
				expect(document, key).not.toHaveProperty(key)
		} finally {
			vi.unstubAllEnvs()
		}
	})
})
