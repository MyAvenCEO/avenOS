import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { androidPasskeyOrigins } from '../src/lib/server/auth.js'
import { serverConfigSchema } from '../src/lib/server/config.js'
import { GET as association } from '../src/routes/.well-known/apple-app-site-association/+server.js'
import {
	_ANDROID_APP_PACKAGE_ID,
	_androidAssetLinks
} from '../src/routes/.well-known/assetlinks.json/+server.js'

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

	it('publishes the Android signing certificates used for passkey association', () => {
		const fingerprint =
			'18:92:65:FF:42:BC:ED:04:74:0C:AB:76:DD:EB:DC:9D:9A:B4:4F:65:10:53:D2:EA:76:73:06:FC:0F:5F:39:59'
		expect(_androidAssetLinks([fingerprint])).toEqual([
			{
				relation: [
					'delegate_permission/common.handle_all_urls',
					'delegate_permission/common.get_login_creds'
				],
				target: {
					namespace: 'android_app',
					package_name: _ANDROID_APP_PACKAGE_ID,
					sha256_cert_fingerprints: [fingerprint]
				}
			}
		])
		expect(androidPasskeyOrigins([fingerprint])).toEqual([
			'android:apk-key-hash:GJJl_0K87QR0DKt23evcnZq0T2UQU9LqdnMG_A9fOVk'
		])
	})

	it('rejects malformed Android signing certificate fingerprints', () => {
		const result = serverConfigSchema.safeParse({
			PUBLIC_BASE_URL: 'https://id.next.aven.ceo',
			WEBAUTHN_RP_ID: 'id.next.aven.ceo',
			ANDROID_APP_CERT_SHA256_FINGERPRINTS: 'not-a-sha256-fingerprint',
			DATABASE_URL: 'postgres://example.invalid/aven'
		})
		expect(result.success).toBe(false)
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
