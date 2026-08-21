import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { addPasskey, api } = vi.hoisted(() => ({
	addPasskey: vi.fn(),
	api: vi.fn()
}))

vi.mock('$lib/api.js', () => ({ api }))
vi.mock('$lib/auth-client.js', () => ({
	authClient: {
		passkey: { addPasskey },
		signIn: { passkey: vi.fn() },
		signOut: vi.fn(),
		useSession: vi.fn()
	}
}))

import { appRuntime } from '../src/lib/app-runtime/runtime.production.js'

describe('production passkey enrollment', () => {
	beforeEach(() => {
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Test' })
		vi.stubGlobal('window', { PublicKeyCredential: class {} })
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		api.mockReset().mockResolvedValueOnce({ requirePasskeyPrf: false }).mockResolvedValueOnce({
			enrolled: true
		})
		addPasskey.mockReset().mockResolvedValue({
			data: {
				id: 'better-auth-database-row-id',
				credentialID: 'webauthn-credential-id'
			},
			error: null
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('finalizes enrollment with the WebAuthn credential ID', async () => {
		await appRuntime.auth.createPasskey('Primary passkey', false)

		expect(api).toHaveBeenNthCalledWith(2, '/passkeys', {
			method: 'POST',
			body: JSON.stringify({
				credentialId: 'webauthn-credential-id',
				prfEnabled: false
			})
		})
	})
})
