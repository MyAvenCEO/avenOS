import { describe, expect, test } from 'vitest'
import {
	normalizeBranch,
	normalizeRepository,
	normalizeSiteHostname
} from '../src/lib/server/sites/validation.js'

describe('static site binding validation', () => {
	test('accepts an external fully-qualified domain', () => {
		expect(normalizeSiteHostname('www.customer.example')).toBe('www.customer.example')
	})

	test.each(['aven.ceo', 'next.aven.ceo', 'customer.next.aven.ceo'])(
		'reserves operator domain %s',
		(hostname) => expect(() => normalizeSiteHostname(hostname)).toThrow(/reserved/)
	)

	test('accepts only owner/repository GitHub identifiers', () => {
		expect(normalizeRepository('MyAvenCEO/avenCEO')).toBe('myavenceo/avenceo')
		expect(() => normalizeRepository('https://example.test/repository')).toThrow()
	})

	test('requires deployment branches below deploy/', () => {
		expect(normalizeBranch('deploy/next', true)).toBe('deploy/next')
		expect(() => normalizeBranch('next', true)).toThrow(/deploy/)
	})
})
