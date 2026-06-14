import { describe, expect, test } from 'bun:test'
import de from '../languages/de.json'
import en from '../languages/en.json'
import { SUPPORTED_LOCALES } from '../src/lib/i18n/locales'

// Board 0047: the access panel renders role + cap labels by key
// (`identities.share.grants.${role}` / `.capabilities.${cap}`). If a key is missing,
// the UI falls back to the RAW key (the live `IDENTITIES.SHARE.GRANTS.ADMIN` regression
// after the 0040 owns→admin rename). This guards that EVERY role/cap the Rust
// `identity_cap_report` can emit has a real translation in EVERY locale — so a future
// vocabulary change can never reintroduce a raw key.

// The roles `identity_cap_report` emits (a role IS a named cap bundle, board 0047).
const ROLES = ['admin', 'reader', 'relay'] as const
// Every cap any role's bundle (`grant_kind_caps`) + granular grants can surface.
const CAPS = [
	'read',
	'write',
	'delete',
	'admit',
	'rotate_dek',
	'replicate',
	'quota',
	'rate_limit',
	'directory'
] as const

const CATALOGS: Record<string, Record<string, unknown>> = { en, de }

describe('i18n access labels (board 0047 — no raw keys)', () => {
	test('SUPPORTED_LOCALES all have a catalog', () => {
		for (const loc of SUPPORTED_LOCALES) expect(CATALOGS[loc]).toBeDefined()
	})

	for (const loc of SUPPORTED_LOCALES) {
		const share = (CATALOGS[loc] as any)?.identities?.share ?? {}

		test(`[${loc}] every role has a non-empty grants label`, () => {
			for (const role of ROLES) {
				const label = share.grants?.[role]
				expect(typeof label === 'string' && label.trim().length > 0).toBe(true)
			}
		})

		test(`[${loc}] every cap has a non-empty capabilities label`, () => {
			for (const cap of CAPS) {
				const label = share.capabilities?.[cap]
				expect(typeof label === 'string' && label.trim().length > 0).toBe(true)
			}
		})

		test(`[${loc}] every role has a grant description`, () => {
			for (const role of ROLES) {
				const key = `grantDesc${role[0].toUpperCase()}${role.slice(1)}`
				const desc = share[key]
				expect(typeof desc === 'string' && desc.trim().length > 0).toBe(true)
			}
		})
	}
})
