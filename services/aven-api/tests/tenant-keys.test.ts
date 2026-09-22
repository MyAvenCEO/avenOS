import { generateKeyPairSync } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { importFacadeTenantKeys } from '../src/tenant-keys.js'

describe('facade tenant signing identity', () => {
	for (const escaped of [false, true]) {
		it(`imports and derives the same identity with ${escaped ? 'environment-escaped' : 'literal'} newlines`, async () => {
			const pair = generateKeyPairSync('ed25519')
			const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
			const keys = await importFacadeTenantKeys(escaped ? pem.replaceAll('\n', '\\n') : pem)
			const token = await new SignJWT({ purpose: 'synthetic startup proof' })
				.setProtectedHeader({ alg: 'EdDSA' })
				.sign(keys.privateKey)
			expect((await jwtVerify(token, keys.publicKey)).payload.purpose).toBe(
				'synthetic startup proof'
			)
			expect((await jwtVerify(token, pair.publicKey)).payload.purpose).toBe(
				'synthetic startup proof'
			)
		})
	}
	it('rejects malformed key material instead of substituting a new identity', async () => {
		await expect(importFacadeTenantKeys('not a private key')).rejects.toThrow()
	})
})
