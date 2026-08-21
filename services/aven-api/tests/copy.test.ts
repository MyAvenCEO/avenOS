import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = (path: string) =>
	readFileSync(resolve(import.meta.dirname, '../src/routes', path), 'utf8')

describe('functional web copy', () => {
	// The point of this test is that every page still NAMES its action rather
	// than gesturing at it. The strings are German now; the rule is unchanged.
	it('keeps the retained actions explicit', () => {
		expect(route('+page.svelte')).toContain('ist frei')
		expect(route('secure/+page.svelte')).toContain('Platz sichern')
		expect(route('login/+page.svelte')).toContain('Mit Passkey anmelden')
		expect(route('device/+page.svelte')).toContain('avenOS verbinden')
		expect(route('passkey/create/+page.svelte')).toContain('Passkey anlegen')
		// The Firefox-on-Linux warning stays asserted; it is translated, not dropped.
		expect(route('passkey/create/+page.svelte')).toContain(
			'Firefox unter Linux hat keinen eingebauten Passkey‑Anbieter.'
		)
		// The download CTA is gone while the app is invite-only; what the holder
		// comes here for is their name and their place in the queue.
		expect(route('dashboard/+page.svelte')).toContain('Für dich reserviert')
		expect(route('dashboard/+page.svelte')).toContain('Die Liste um dich herum')
	})

	it('does not add product or release-stage copy', () => {
		const pages = [
			'+layout.svelte',
			'+page.svelte',
			'secure/+page.svelte',
			'login/+page.svelte',
			'device/+page.svelte',
			'passkey/create/+page.svelte',
			'dashboard/+page.svelte',
			'purchase/checkout/+page.svelte',
			'purchase/success/+page.svelte',
			'purchase/expired/+page.svelte'
		]
		const source = pages.map(route).join('\n').toLowerCase()
		for (const phrase of [
			'revolutionary',
			'unlock your',
			'transform your',
			'limited time',
			'not for production',
			'coming soon',
			' demo',
			' beta',
			' preview',
			'spark'
		]) {
			expect(source).not.toContain(phrase)
		}
	})
})
