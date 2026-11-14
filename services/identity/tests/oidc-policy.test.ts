import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { safeReturnPath } from '../src/lib/return-path.js'
import { identityConfigSchema } from '../src/lib/server/config.js'
import type { Queryable } from '../src/lib/server/db.js'
import { oidcGate, stripPluginResumeCookies } from '../src/lib/server/oidc.js'

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
			[{ ...exchange, client_id: 'unknown' }, {}, 'invalid_client'],
			[{ ...exchange, client_secret: 'secret' }, {}, 'invalid_client'],
			[exchange, { authorization: `Basic ${btoa('coordinator:secret')}` }, 'invalid_client'],
			[{ ...exchange, code_verifier: 'short' }, {}, 'invalid_request'],
			[{ ...exchange, code_verifier: '' }, {}, 'invalid_request']
		] as const) {
			const result = (await token(body, headers)) as Response
			expect(result).toBeInstanceOf(Response)
			expect((await result.json()).error).toBe(error)
		}
	})

	test('closes dynamic registration, consent, client lookup, logout and plugin discovery', async () => {
		for (const path of [
			'/api/auth/oauth2/register',
			'/api/auth/oauth2/consent',
			'/api/auth/oauth2/client/coordinator',
			'/api/auth/oauth2/endsession',
			'/api/auth/.well-known/openid-configuration'
		]) {
			const result = (await oidcGate({
				request: new Request(`https://aven.id${path}`, { method: 'POST' }),
				config,
				pool: pool(true),
				getSession: async () => session
			})) as Response
			expect(result.status, path).toBe(404)
		}
	})

	test('strips the plugin resume cookies so a later sign-in cannot mint a code', () => {
		const request = stripPluginResumeCookies(
			new Request('https://aven.id/api/auth/sign-in/setup-token', {
				headers: {
					cookie: 'better-auth.session_token=a; oidc_login_prompt=b; __Secure-oidc_consent_prompt=c'
				}
			})
		)
		expect(request.headers.get('cookie')).toBe('better-auth.session_token=a')
	})
})
