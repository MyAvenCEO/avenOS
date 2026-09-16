import { describe, expect, it } from 'vitest'
import { canonicalBrowserLanguage, preferredBrowserLanguage } from '../src/lib/validation.js'

describe('browser language', () => {
	it('canonicalizes a declared language tag', () => {
		expect(canonicalBrowserLanguage('de-de')).toBe('de-DE')
		expect(canonicalBrowserLanguage('not_a_language')).toBeUndefined()
	})

	it('selects the highest-priority concrete Accept-Language entry', () => {
		expect(preferredBrowserLanguage('de-DE;q=0.7, en-gb;q=0.9, *;q=1')).toBe('en-GB')
		expect(preferredBrowserLanguage('de;q=0, en;q=0')).toBeUndefined()
	})
})
