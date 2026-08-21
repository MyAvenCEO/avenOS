import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = (path: string) =>
	readFileSync(resolve(import.meta.dirname, '../src/routes', path), 'utf8')

describe('functional web copy', () => {
	it('keeps the retained actions explicit', () => {
		expect(route('+page.svelte')).toContain('<h1>Check name</h1>')
		expect(route('secure/+page.svelte')).toContain('Send checkout link')
		expect(route('login/+page.svelte')).toContain('Sign in with passkey')
		expect(route('device/+page.svelte')).toContain('Connect avenOS')
		expect(route('passkey/create/+page.svelte')).toContain('Passkey name')
		expect(route('passkey/create/+page.svelte')).toContain(
			'Firefox on Linux has no built-in platform passkey provider.'
		)
		expect(route('dashboard/+page.svelte')).toContain('Download AvenOS')
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
