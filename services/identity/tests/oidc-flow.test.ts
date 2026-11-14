import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'
import { resolve } from 'node:path'
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
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
const SECRET = 'identity-oidc-test-secret-32-bytes!!'

describe.skipIf(!adminUrl)('OpenID Connect authorization code + PKCE', () => {
	const name = `identity_oidc_${randomUUID().replaceAll('-', '')}`
	let admin: pg.Pool
	let database: DatabaseContext
	let passkeys: PasskeyService
	let adapter: ReturnType<ReturnType<typeof enrollmentAdapter>>
	let handle: typeof import('../src/hooks.server.js').handle
	let auth: ReturnType<typeof createAuth>
	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: adminUrl })
		for (const role of [
			'aven_identity_auth',
			'aven_identity_accounts',
			'aven_identity_authorization',
			'aven_identity_migrator'
		])
			await admin.query(
				`DO $$ BEGIN CREATE ROLE ${role}; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`
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
			BETTER_AUTH_SECRET: SECRET,
			IDENTITY_PROVISIONING_SECRETS: 'identity-oidc-test-provisioning-32-bytes',
			OIDC_CLIENTS: JSON.stringify([
				{ client_id: CLIENT_ID, name: 'Coordinator', redirect_uris: [REDIRECT_URI] }
			])
		})
		auth = createAuth(config, database, (token) => passkeys.verifySetupLink(token))
		adapter = enrollmentAdapter(database)((await auth.$context).options)
		// Proof of work is covered elsewhere; here it lets passkey sign-in requests through.
		state.runtime = { auth, config, database, proofOfWork: { verifyAndConsume: async () => {} } }
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
		// The gate, not the plugin, sends the browser to sign in: no signed, resumable query.
		expect(location.searchParams.get('returnTo')).not.toContain('sig=')
		expect(response.headers.get('set-cookie')).toBeNull()
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
			(
				await database.pool.query(
					`SELECT 1 FROM verification WHERE value LIKE '%"authorization_code"%'
					 AND (value LIKE $1 OR value LIKE $2)`,
					[`%${pending.id}%`, `%${bare.id}%`]
				)
			).rows
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
		expect(callback.searchParams.get('iss')).toBe(ISSUER)
		const code = callback.searchParams.get('code')!
		expect(code).toMatch(/^[A-Za-z0-9]{32}$/)
		const stored = (
			await database.pool.query<{ expires_at: Date; created_at: Date; identifier: string }>(
				`SELECT expires_at, created_at, identifier FROM verification
				 WHERE value LIKE '%"authorization_code"%' AND value LIKE $1`,
				[`%${user.id}%`]
			)
		).rows
		expect(stored).toHaveLength(1)
		expect(stored[0].identifier).not.toBe(code)
		expect(stored[0].expires_at.getTime() - stored[0].created_at.getTime()).toBe(120_000)

		const wrong = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: pkce().verifier
		})
		expect(wrong.status).toBe(400)
		expect((await wrong.json()).error).toBe('invalid_grant')
		const foreignRedirect = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code,
			redirect_uri: 'http://localhost:4000/other',
			code_verifier: verifier
		})
		expect(foreignRedirect.status).toBe(400)
		const tokens = await exchange(
			{
				grant_type: 'authorization_code',
				client_id: CLIENT_ID,
				code,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier
			},
			CLIENT_ORIGIN
		)
		expect(tokens.status).toBe(200)
		expect(tokens.headers.get('access-control-allow-origin')).toBe(CLIENT_ORIGIN)
		expect(tokens.headers.get('access-control-allow-credentials')).toBeNull()
		expect(tokens.headers.get('cache-control')).toBe('no-store')
		const body = await tokens.json()
		expect(body.refresh_token).toBeUndefined()
		expect(body.token_type).toBe('Bearer')
		expect(body.expires_in).toBe(300)
		expect(body.scope).toBe('openid profile email')
		const claims = await verifyIdToken(body.id_token)
		const created = (
			await database.pool.query<{ created_at: Date }>(
				'SELECT s.created_at FROM session s WHERE s.token=$1',
				[headers.authorization.slice('Bearer '.length)]
			)
		).rows[0].created_at
		expect(claims).toMatchObject({
			iss: ISSUER,
			aud: CLIENT_ID,
			sub: user.id,
			email: user.email,
			email_verified: true,
			nonce: 'nonce-123',
			amr: ['passkey'],
			name: 'Ada Lovelace',
			given_name: 'Ada',
			family_name: 'Lovelace',
			auth_time: Math.floor(created.getTime() / 1000)
		})
		for (const claim of ['role', 'scope', 'sid', 'acr', 'client_id', 'azp'])
			expect(claims, claim).not.toHaveProperty(claim)
		expect(Number(claims.exp) - Number(claims.iat)).toBe(300)
		// Re-signing for `amr` keeps the plugin's at_hash binding to this access token.
		const digest = createHash('sha512').update(body.access_token).digest()
		expect(claims.at_hash).toBe(digest.subarray(0, 32).toString('base64url'))

		const userinfo = await send('/api/auth/oauth2/userinfo', {
			headers: { authorization: `Bearer ${body.access_token}`, origin: CLIENT_ORIGIN }
		})
		expect(userinfo.status).toBe(200)
		expect(userinfo.headers.get('access-control-allow-origin')).toBe(CLIENT_ORIGIN)
		const info = await userinfo.json()
		expect(info).toMatchObject({
			sub: user.id,
			email: user.email,
			email_verified: true,
			name: 'Ada Lovelace'
		})
		expect(typeof info.updated_at).toBe('number')

		// A redeemed code is single-use, and replaying it revokes what it issued.
		const replay = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier
		})
		expect(replay.status).toBe(400)
		expect((await replay.json()).error).toBe('invalid_grant')
		const revoked = await send('/api/auth/oauth2/userinfo', {
			headers: { authorization: `Bearer ${body.access_token}` }
		})
		expect(revoked.status).toBe(401)
	})

	test('an unredeemed code expires and signing out revokes issued access tokens', async () => {
		const user = await account()
		await addPasskey(user.id)
		const headers = await session(user.id)
		const { verifier, challenge } = pkce()
		const first = new URL(
			(await send(authorizePath(challenge), { headers })).headers.get('location')!
		)
		await database.pool.query(
			`UPDATE verification SET expires_at = now() - interval '1 second'
			 WHERE value LIKE '%"authorization_code"%' AND value LIKE $1`,
			[`%${user.id}%`]
		)
		const expired = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code: first.searchParams.get('code')!,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier
		})
		expect(expired.status).toBe(400)
		const second = new URL(
			(await send(authorizePath(challenge), { headers })).headers.get('location')!
		)
		const tokens = await exchange({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			code: second.searchParams.get('code')!,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier
		})
		expect(tokens.status).toBe(200)
		const { access_token } = await tokens.json()
		const out = await send('/api/auth/sign-out', {
			method: 'POST',
			headers: { ...headers, origin: ISSUER, 'content-type': 'application/json' },
			body: '{}'
		})
		expect(out.status).toBe(200)
		const userinfo = await send('/api/auth/oauth2/userinfo', {
			headers: { authorization: `Bearer ${access_token}` }
		})
		expect(userinfo.status).toBe(401)
	})

	test('only the gate leads to a code: signed oauth_query bodies are refused everywhere', async () => {
		// Ask the plugin directly (bypassing the gate) to sign a resumable query, as it does
		// when it redirects a signed-out browser to its login page.
		const { challenge } = pkce()
		const direct = await auth.handler(new Request(`${ISSUER}${authorizePath(challenge)}`))
		const loginRedirect = new URL(direct.headers.get('location')!, ISSUER)
		expect(loginRedirect.pathname).toBe('/login')
		const signed = loginRedirect.search.slice(1)
		expect(await verifyOAuthQueryParams(signed, SECRET)).toBe(true)
		const user = await account()
		await addPasskey(user.id)
		const headers = await session(user.id)
		for (const path of [
			'/api/auth/passkey/verify-authentication',
			'/api/auth/passkey/verify-registration',
			'/api/auth/revoke-sessions',
			'/api/auth/sign-out',
			'/api/auth/device/approve',
			'/api/auth/update-user'
		]) {
			for (const body of [
				{ type: 'application/json', value: JSON.stringify({ oauth_query: signed }) },
				{
					type: 'application/x-www-form-urlencoded',
					value: new URLSearchParams({ oauth_query: signed }).toString()
				}
			]) {
				const response = await send(path, {
					method: 'POST',
					headers: { ...headers, origin: ISSUER, 'content-type': body.type },
					body: body.value
				})
				// JSON endpoints refuse form bodies before any hook (415); parsed bodies hit the hook.
				if (body.type === 'application/json') {
					expect(response.status, path).toBe(400)
					expect((await response.json()).code).toBe('OAUTH_QUERY_NOT_ACCEPTED')
				} else expect([400, 415], path).toContain(response.status)
			}
		}
		for (const path of ['/api/auth/oauth2/continue', '/api/auth/oauth2/consent'])
			expect(
				(
					await send(path, {
						method: 'POST',
						headers: { ...headers, origin: ISSUER, 'content-type': 'application/json' },
						body: JSON.stringify({ oauth_query: signed, accept: true, selected: true })
					})
				).status
			).toBe(404)
		expect(
			(
				await database.pool.query(
					`SELECT 1 FROM verification WHERE value LIKE '%"authorization_code"%' AND value LIKE $1`,
					[`%${user.id}%`]
				)
			).rows
		).toHaveLength(0)
	})

	test('every oauth-provider endpoint except authorize, token and userinfo answers 404', async () => {
		const plugin = ((await auth.$context).options.plugins ?? []).find(
			(candidate) => candidate.id === 'oauth-provider'
		) as { endpoints?: Record<string, unknown> } | undefined
		const endpoints = Object.values(plugin?.endpoints ?? {}) as Array<{
			path?: string
			options?: { method?: string | string[]; metadata?: { SERVER_ONLY?: boolean } }
		}>
		expect(endpoints.length).toBeGreaterThan(30)
		const user = await account()
		await addPasskey(user.id)
		const headers = await session(user.id)
		const open = ['/oauth2/authorize', '/oauth2/token', '/oauth2/userinfo']
		for (const endpoint of endpoints) {
			if (!endpoint.path || open.includes(endpoint.path)) continue
			const path = `/api/auth${endpoint.path.replaceAll(/:[A-Za-z_]+/g, 'x')}`
			const methods = [endpoint.options?.method ?? 'GET'].flat()
			for (const method of methods) {
				const response = await send(path, {
					method,
					headers: {
						...headers,
						origin: ISSUER,
						...(method === 'GET' ? {} : { 'content-type': 'application/json' })
					},
					...(method === 'GET' ? {} : { body: '{}' })
				})
				expect(response.status, `${method} ${path}`).toBe(404)
			}
		}
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
			(await database.pool.query('SELECT count(*)::int AS n FROM oauth_client')).rows[0].n
		).toBe(0)
	})

	test('the runtime role cannot register clients, consents or refresh tokens', async () => {
		const client = await database.pool.connect()
		try {
			await client.query('SET ROLE aven_identity_auth')
			for (const table of [
				'oauth_client',
				'oauth_access_token',
				'oauth_refresh_token',
				'oauth_consent',
				'oauth_resource',
				'oauth_client_resource'
			])
				await client.query(`SELECT 1 FROM ${table}`)
			for (const statement of [
				`INSERT INTO oauth_client(id,client_id,redirect_uris) VALUES('x','x','{https://evil.example/cb}')`,
				`UPDATE oauth_client SET redirect_uris='{https://evil.example/cb}'`,
				`INSERT INTO oauth_consent(id,client_id,scopes) VALUES('x','x','{openid}')`,
				`INSERT INTO oauth_refresh_token(id,token,client_id,user_id,expires_at,created_at,scopes)
				 VALUES('x','x','x','x',now(),now(),'{openid,offline_access}')`,
				`UPDATE oauth_refresh_token SET revoked=NULL`,
				`INSERT INTO oauth_resource(id,identifier,name) VALUES('x','https://evil.example','x')`,
				`INSERT INTO oauth_client_resource(id,client_id,resource_id) VALUES('x','x','x')`,
				'SELECT 1 FROM oauth_client_assertion'
			])
				await expect(client.query(statement), statement).rejects.toThrow(/permission denied/)
		} finally {
			await client.query('RESET ROLE').catch(() => {})
			client.release()
		}
	})

	test('the Drizzle schema covers every table and column Better Auth writes', async () => {
		const context = await auth.$context
		expect(context.checkSchema).toBeTypeOf('function')
		await expect(Promise.resolve(context.checkSchema?.())).resolves.toBeUndefined()
	})

	test('the native device flow shows its client only to the claiming account', async () => {
		// The avenOS app sends JSON to both public device endpoints (app/src-tauri/src/auth.rs).
		const post = (body: Record<string, string>) => ({
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
		expect(
			(await send('/api/auth/device/code', post({ client_id: CLIENT_ID, scope: 'openid' }))).status
		).toBe(400)
		const issued = await send(
			'/api/auth/device/code',
			post({ client_id: 'ceo.aven.os', scope: 'openid' })
		)
		expect(issued.status).toBe(200)
		const { device_code, user_code } = await issued.json()
		const owner = await account()
		await addPasskey(owner.id)
		const ownerHeaders = await session(owner.id)
		const other = await account()
		await addPasskey(other.id)
		const otherHeaders = await session(other.id)
		const claim = await send(`/api/auth/device?user_code=${user_code}`, { headers: ownerHeaders })
		expect(await claim.json()).toMatchObject({ status: 'pending', client_id: 'ceo.aven.os' })
		const peek = await (
			await send(`/api/auth/device?user_code=${user_code}`, { headers: otherHeaders })
		).json()
		expect(peek).not.toHaveProperty('client_id')
		const approve = (headers: Record<string, string>) =>
			send('/api/auth/device/approve', {
				method: 'POST',
				headers: { ...headers, origin: ISSUER, 'content-type': 'application/json' },
				body: JSON.stringify({ userCode: user_code })
			})
		expect((await approve(otherHeaders)).status).toBe(403)
		expect((await approve(ownerHeaders)).status).toBe(200)
		const token = await send(
			'/api/auth/device/token',
			post({
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code,
				client_id: 'ceo.aven.os'
			})
		)
		expect(token.status).toBe(200)
		const { access_token } = await token.json()
		const me = await send('/api/auth/get-session', {
			headers: { authorization: `Bearer ${access_token}` }
		})
		expect((await me.json()).user.id).toBe(owner.id)
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
