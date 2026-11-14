import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createAuth } from '../src/lib/server/auth.js'
import { identityConfigSchema } from '../src/lib/server/config.js'
import { type DatabaseContext, migrate, openDatabase } from '../src/lib/server/db.js'
import { enrollmentAdapter } from '../src/lib/server/enrollment.js'
import { PasskeyService } from '../src/lib/server/passkeys.js'
import { sha256Hex } from '../src/lib/server/tokens.js'

// The flow runs through the real SvelteKit `handle` hook, so the path gate, origin checks,
// CORS and the setup-session gate are exercised exactly as deployed.
const state = vi.hoisted(() => ({ runtime: undefined as unknown }))
vi.mock('$app/environment', () => ({ building: false }))
vi.mock('$lib/server/runtime.js', () => ({ runtime: async () => state.runtime }))

const adminUrl = process.env.TEST_IDENTITY_ADMIN_DATABASE_URL
const ISSUER = 'http://localhost:3100'
const CLIENT_ID = 'coordinator'
const REDIRECT_URI = 'http://localhost:4000/auth/callback'
const CLIENT_ORIGIN = 'http://localhost:4000'

describe.skipIf(!adminUrl)('OpenID Connect authorization code + PKCE', () => {
	const name = `identity_oidc_${randomUUID().replaceAll('-', '')}`
	let admin: pg.Pool
	let database: DatabaseContext
	let passkeys: PasskeyService
	let adapter: ReturnType<ReturnType<typeof enrollmentAdapter>>
	let handle: typeof import('../src/hooks.server.js').handle
	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: adminUrl })
		for (const role of [
			'aven_identity_auth',
			'aven_identity_accounts',
			'aven_identity_authorization',
			'aven_identity_migrator'
		])
			await admin.query(
				`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
			)
		await admin.query(`CREATE DATABASE ${name}`)
		const url = new URL(adminUrl!)
		url.pathname = `/${name}`
		database = openDatabase(url.href)
		await migrate(database, resolve('migrations'))
		passkeys = new PasskeyService(database.pool, false)
		const config = identityConfigSchema.parse({
			PUBLIC_BASE_URL: ISSUER,
			DATABASE_URL: url.href,
			BETTER_AUTH_SECRET: 'identity-oidc-test-secret-32-bytes!!',
			IDENTITY_PROVISIONING_SECRETS: 'identity-oidc-test-provisioning-32-bytes',
			OIDC_CLIENTS: JSON.stringify([
				{ client_id: CLIENT_ID, name: 'Coordinator', redirect_uris: [REDIRECT_URI] }
			])
		})
		const auth = createAuth(config, database, (token) => passkeys.verifySetupLink(token))
		adapter = enrollmentAdapter(database)((await auth.$context).options)
		state.runtime = { auth, config, database, proofOfWork: {} }
		handle = (await import('../src/hooks.server.js')).handle
	})
	afterAll(async () => {
		await database?.pool.end()
		if (admin) {
			await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
			await admin.end()
		}
	})

	let address = 0
	async function send(path: string, init: RequestInit = {}) {
		const headers = new Headers(init.headers)
		// A distinct client address per call keeps the shared rate-limit bucket out of the way.
		headers.set('x-forwarded-for', `10.0.0.${++address % 250}`)
		const request = new Request(`${ISSUER}${path}`, { ...init, headers })
		return handle({
			event: { request, url: new URL(request.url) } as never,
			resolve: (async () => new Response('not found', { status: 404 })) as never
		}) as Promise<Response>
	}
	async function account(email = `${randomUUID()}@example.test`) {
		const id = randomUUID()
		await database.pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$2,$3,true,now(),now())',
			[id, 'Ada Lovelace', email]
		)
		return { id, email }
	}
	async function addPasskey(userId: string) {
		await database.pool.query(
			`INSERT INTO passkey(id,public_key,user_id,credential_id,counter,device_type,backed_up,created_at)
			 VALUES($1,'test-fixture-only',$2,$3,0,'singleDevice',false,now())`,
			[randomUUID(), userId, randomUUID()]
		)
	}
	async function session(userId: string, setupToken?: string) {
		const token = randomUUID()
		await adapter.create({
			model: 'session',
			data: {
				userId,
				token,
				...(setupToken ? { setupTokenHash: sha256Hex(setupToken) } : {}),
				expiresAt: new Date(Date.now() + 1800_000),
				createdAt: new Date(),
				updatedAt: new Date()
			}
		})
		return { authorization: `Bearer ${token}` }
	}
	function pkce() {
		const verifier = randomBytes(32).toString('base64url')
		return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
	}
	function authorizePath(challenge: string, extra: Record<string, string> = {}) {
		return `/api/auth/oauth2/authorize?${new URLSearchParams({
			response_type: 'code',
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			scope: 'openid profile email',
			state: 'opaque-state',
			nonce: 'nonce-123',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			...extra
		})}`
	}
	async function exchange(body: Record<string, string>, origin?: string) {
		return send('/api/auth/oauth2/token', {
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
				...(origin ? { origin } : {})
			},
			body: new URLSearchParams(body)
		})
	}
	async function verifyIdToken(token: string) {
		const jwks = (await (await send('/api/auth/jwks')).json()) as {
			keys: Array<Record<string, string>>
		}
		const [header, payload, signature] = token.split('.')
		const protectedHeader = JSON.parse(Buffer.from(header, 'base64url').toString())
		expect(protectedHeader.alg).toBe('EdDSA')
		const key = jwks.keys.find((candidate) => candidate.kid === protectedHeader.kid)
		expect(key).toBeDefined()
		const { kty, crv, x } = key!
		expect(
			verify(
				null,
				Buffer.from(`${header}.${payload}`),
				createPublicKey({ key: { kty, crv, x }, format: 'jwk' }),
				Buffer.from(signature, 'base64url')
			)
		).toBe(true)
		return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
	}

	test('signed-out authorization goes through /login and resumes the same request', async () => {
		const { challenge } = pkce()
		const response = await send(authorizePath(challenge))
		expect(response.status).toBe(302)
		const location = new URL(response.headers.get('location')!, ISSUER)
		expect(location.pathname).toBe('/login')
		expect(location.searchParams.get('returnTo')).toBe(authorizePath(challenge))
		expect(response.headers.get('set-cookie') ?? '').not.toContain('oidc_login_prompt')
	})

	test('a setup-link session and a passkey-less account get no code', async () => {
		const pending = await account()
		const token = (await passkeys.issueSetupLink(pending.id))!
		const { challenge } = pkce()
		const setup = await send(authorizePath(challenge), {
			headers: await session(pending.id, token)
		})
		expect(setup.status).toBe(302)
		expect(setup.headers.get('location')).toBe('/dashboard')
		const silent = await send(authorizePath(challenge, { prompt: 'none' }), {
			headers: await session(pending.id, token)
		})
		expect(new URL(silent.headers.get('location')!).searchParams.get('error')).toBe(
			'login_required'
		)
		const bare = await account()
		const plain = await send(authorizePath(challenge), { headers: await session(bare.id) })
		expect(plain.headers.get('location')).toBe('/dashboard')
		expect(
			(await database.pool.query("SELECT 1 FROM verification WHERE value LIKE '%clientId%'")).rows
		).toHaveLength(0)
	})

	test('unknown clients, unregistered redirects and missing or plain PKCE are refused', async () => {
		const user = await account()
		await addPasskey(user.id)
		const headers = await session(user.id)
		const { verifier, challenge } = pkce()
		expect((await send(authorizePath(challenge, { client_id: 'other' }), { headers })).status).toBe(
			400
		)
		const foreign = await send(
			authorizePath(challenge, { redirect_uri: 'http://localhost:4000/x' }),
			{
				headers
			}
		)
		expect(foreign.status).toBe(400)
		expect(foreign.headers.get('location')).toBeNull()
		const refused: Record<string, string>[] = [
			{ code_challenge_method: 'plain', code_challenge: verifier },
			{ code_challenge: '' },
			{ scope: 'openid offline_access' }
		]
		for (const extra of refused) {
			const response = await send(authorizePath(challenge, extra), { headers })
			const location = new URL(response.headers.get('location')!)
			expect(location.searchParams.get('error')).toMatch(/invalid_request|invalid_scope/)
			expect(location.searchParams.get('code')).toBeNull()
		}
	})

	test('a passkey session exchanges a code for a verifiable ID token', async () => {
		const user = await account()
		await addPasskey(user.id)
		const headers = await session(user.id)
		const { verifier, challenge } = pkce()
		const response = await send(authorizePath(challenge, { prompt: 'consent' }), { headers })
		expect(response.status).toBe(302)
		const callback = new URL(response.headers.get('location')!)
		expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT_URI)
		expect(callback.searchParams.get('state')).toBe('opaque-state')
		const code = callback.searchParams.get('code')!
		expect(code).toMatch(/^[A-Za-z0-9]{32}$/)

		const wrong = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: pkce().verifier
		})
		expect(wrong.status).toBe(401)
		// A failed verifier burns the code; authorize again for the real exchange.
		const again = await send(authorizePath(challenge), { headers })
		const freshCode = new URL(again.headers.get('location')!).searchParams.get('code')!
		const tokens = await exchange(
			{
				grant_type: 'authorization_code',
				client_id: CLIENT_ID,
				code: freshCode,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier
			},
			CLIENT_ORIGIN
		)
		expect(tokens.status).toBe(200)
		expect(tokens.headers.get('access-control-allow-origin')).toBe(CLIENT_ORIGIN)
		expect(tokens.headers.get('access-control-allow-credentials')).toBeNull()
		const body = await tokens.json()
		expect(body.refresh_token).toBeUndefined()
		expect(body.token_type).toBe('Bearer')
		const claims = await verifyIdToken(body.id_token)
		expect(claims).toMatchObject({
			iss: ISSUER,
			aud: CLIENT_ID,
			sub: user.id,
			email: user.email,
			email_verified: true,
			nonce: 'nonce-123',
			amr: ['passkey'],
			name: 'Ada Lovelace'
		})
		expect(claims).not.toHaveProperty('role')
		expect(claims).not.toHaveProperty('scope')
		expect(claims).not.toHaveProperty('auth_time')
		expect(Number(claims.exp) - Number(claims.iat)).toBe(300)

		const replay = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code: freshCode,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier
		})
		expect(replay.status).toBe(401)

		const userinfo = await send('/api/auth/oauth2/userinfo', {
			headers: { authorization: `Bearer ${body.access_token}`, origin: CLIENT_ORIGIN }
		})
		expect(userinfo.status).toBe(200)
		expect(await userinfo.json()).toMatchObject({ sub: user.id, email: user.email })
	})

	test('the token endpoint refuses the refresh grant and missing PKCE', async () => {
		expect(
			(
				await exchange({
					grant_type: 'refresh_token',
					client_id: CLIENT_ID,
					refresh_token: 'anything'
				})
			).status
		).toBe(400)
		expect(
			(
				await exchange({
					grant_type: 'authorization_code',
					client_id: CLIENT_ID,
					code: 'x',
					redirect_uri: REDIRECT_URI
				})
			).status
		).toBe(400)
	})

	test('dynamic registration stays closed even for a signed-in passkey user', async () => {
		const user = await account()
		await addPasskey(user.id)
		const response = await send('/api/auth/oauth2/register', {
			method: 'POST',
			headers: {
				...(await session(user.id)),
				origin: ISSUER,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] })
		})
		expect(response.status).toBe(404)
		expect(
			(await database.pool.query('SELECT count(*)::int AS n FROM oauth_application')).rows[0].n
		).toBe(0)
	})

	test('the runtime role cannot register clients or consents in the database', async () => {
		const client = await database.pool.connect()
		try {
			await client.query('SET ROLE aven_identity_auth')
			await client.query('SELECT 1 FROM oauth_application')
			await client.query('SELECT 1 FROM oauth_access_token')
			for (const statement of [
				`INSERT INTO oauth_application(id,name,client_id,redirect_urls,type,created_at,updated_at)
				 VALUES('x','x','x','https://evil.example/cb','public',now(),now())`,
				`INSERT INTO oauth_consent(id,client_id,user_id,scopes,consent_given,created_at,updated_at)
				 VALUES('x','x','x','openid',true,now(),now())`
			])
				await expect(client.query(statement)).rejects.toThrow(/permission denied/)
		} finally {
			await client.query('RESET ROLE').catch(() => {})
			client.release()
		}
	})

	test('the existing service token endpoint is unchanged', async () => {
		const user = await account()
		await addPasskey(user.id)
		const response = await send('/api/auth/token', { headers: await session(user.id) })
		expect(response.status).toBe(200)
		const claims = await verifyIdToken((await response.json()).token)
		expect(claims).toMatchObject({
			iss: ISSUER,
			aud: 'aven-services',
			sub: user.id,
			amr: ['passkey'],
			scope: 'openid profile email services:access'
		})
	})
})
