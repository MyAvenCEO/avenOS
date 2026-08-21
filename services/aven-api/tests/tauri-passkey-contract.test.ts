import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serverConfigSchema } from '../src/lib/server/config.js'
import { GET as association } from '../src/routes/.well-known/apple-app-site-association/+server.js'

describe('Tauri passkey contract', () => {
	it('keeps PRF optional for the authentication spike', () => {
		const config = serverConfigSchema.parse({
			PUBLIC_BASE_URL: 'https://id.aven.ceo',
			WEBAUTHN_RP_ID: 'id.aven.ceo',
			DATABASE_URL: 'postgres://example.invalid/aven'
		})
		expect(config.REQUIRE_PASSKEY_PRF).toBe(false)
	})

	it('serves the signed application identifier as JSON', async () => {
		const response = association()
		expect(response.headers.get('content-type')).toContain('application/json')
		expect(await response.json()).toEqual({
			webcredentials: { apps: ['2P6VCHVJWB.ceo.aven.os'] }
		})
	})

	it('keeps staging and production identity domains in both entitlement templates', () => {
		for (const path of [
			'../../../app/src-tauri/Entitlements-appstore.plist',
			'../../../app/src-tauri/ios-template/aven-os-app_iOS.entitlements'
		]) {
			const entitlement = readFileSync(resolve(import.meta.dirname, path), 'utf8')
			expect(entitlement).toContain('webcredentials:id.aven.ceo')
			expect(entitlement).toContain('webcredentials:id.next.aven.ceo')
		}
	})

	it('rejects an RP ID outside the configured origin', () => {
		const result = serverConfigSchema.safeParse({
			NODE_ENV: 'production',
			PUBLIC_BASE_URL: 'https://id.aven.ceo',
			WEBAUTHN_RP_ID: 'id.next.aven.ceo',
			DATABASE_URL: 'postgres://example.invalid/aven'
		})
		expect(result.success).toBe(false)
	})

	it('rejects a non-HTTPS production origin', () => {
		const result = serverConfigSchema.safeParse({
			NODE_ENV: 'production',
			PUBLIC_BASE_URL: 'http://id.aven.ceo',
			WEBAUTHN_RP_ID: 'id.aven.ceo',
			DATABASE_URL: 'postgres://example.invalid/aven'
		})
		expect(result.success).toBe(false)
	})
})
