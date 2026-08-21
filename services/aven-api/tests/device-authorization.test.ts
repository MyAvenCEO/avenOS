import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AVENOS_DEVICE_CLIENT_ID, createAuth } from '../src/lib/server/auth.js'
import { createTestDatabase, insertUser, type TestDatabase, testConfig } from './helpers.js'

describe('avenOS device authorization', () => {
	let database: TestDatabase
	const config = testConfig()

	beforeAll(async () => {
		database = await createTestDatabase()
	})

	afterAll(async () => {
		await database.teardown()
	})

	function request(path: string, body?: unknown, headers: HeadersInit = {}) {
		return new Request(`${config.PUBLIC_BASE_URL}/api/auth${path}`, {
			method: body === undefined ? 'GET' : 'POST',
			headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	}

	it('exchanges an approved one-time code for a bearer session', async () => {
		const auth = createAuth(config, database, {
			verifySetupLogin: async () => null,
			verifyPurchaseLogin: async () => null
		})
		const rejected = await auth.handler(request('/device/code', { client_id: 'unknown' }))
		expect(rejected.status).toBe(400)

		const user = await insertUser(database)
		const issued = await auth.handler(
			request('/device/code', { client_id: AVENOS_DEVICE_CLIENT_ID })
		)
		expect(issued.status).toBe(200)
		const grant = (await issued.json()) as {
			device_code: string
			user_code: string
			verification_uri_complete: string
		}
		expect(grant.verification_uri_complete).toContain('/device?user_code=')
		const pending = await auth.handler(
			request('/device/token', {
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: grant.device_code,
				client_id: AVENOS_DEVICE_CLIENT_ID
			})
		)
		expect(pending.status).toBe(400)
		expect(await pending.json()).toMatchObject({ error: 'authorization_pending' })

		await database.pool.query(
			"UPDATE device_code SET user_id=$1,status='approved',last_polled_at=NULL WHERE device_code=$2",
			[user.id, grant.device_code]
		)
		const exchanged = await auth.handler(
			request('/device/token', {
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: grant.device_code,
				client_id: AVENOS_DEVICE_CLIENT_ID
			})
		)
		expect(exchanged.status).toBe(200)
		const token = (await exchanged.json()) as { access_token: string; token_type: string }
		expect(token.token_type).toBe('Bearer')
		expect(token.access_token).toBeTruthy()
		expect(
			await auth.api.getSession({
				headers: new Headers({ authorization: `Bearer ${token.access_token}` })
			})
		).toMatchObject({ user: { id: user.id } })

		const session = await auth.handler(
			request('/get-session', undefined, { authorization: `Bearer ${token.access_token}` })
		)
		expect(session.status).toBe(200)
		expect(await session.json()).toMatchObject({ user: { id: user.id, email: user.email } })

		const replay = await auth.handler(
			request('/device/token', {
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				device_code: grant.device_code,
				client_id: AVENOS_DEVICE_CLIENT_ID
			})
		)
		expect(replay.status).toBe(400)
		expect(await replay.json()).toMatchObject({ error: 'invalid_grant' })
	})
})
