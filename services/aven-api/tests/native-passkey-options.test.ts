import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAuth, requirePasskeyUserVerification } from '../src/lib/server/auth.js'
import { createTestDatabase, type TestDatabase, testConfig } from './helpers.js'

describe('native passkey authentication options', () => {
	let database: TestDatabase
	const config = testConfig({
		PUBLIC_BASE_URL: 'https://id.next.aven.ceo',
		WEBAUTHN_RP_ID: 'id.next.aven.ceo'
	})

	beforeAll(async () => {
		database = await createTestDatabase()
	})

	afterAll(async () => {
		await database.teardown()
	})

	it('issues a discoverable authentication challenge for the avenOS RP ID', async () => {
		const auth = createAuth(config, database, {
			verifySetupLogin: async () => null,
			verifyPurchaseLogin: async () => null
		})
		const response = await auth.handler(
			new Request(`${config.PUBLIC_BASE_URL}/api/auth/passkey/generate-authenticate-options`, {
				headers: { origin: config.PUBLIC_BASE_URL }
			})
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			rpId: 'id.next.aven.ceo',
			userVerification: 'preferred'
		})
		expect(response.headers.get('set-cookie')).toContain('better-auth-passkey=')
	})

	it('requires biometric or device-PIN verification', () => {
		expect(() => requirePasskeyUserVerification(false)).toThrow('requires user verification')
		expect(() => requirePasskeyUserVerification(true)).not.toThrow()
	})
})
