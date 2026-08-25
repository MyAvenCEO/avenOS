import { describe, expect, test } from 'vitest'
import { isSiteDirectoryRequestAuthorized } from '../src/lib/server/sites/directory-auth.js'

const token = 'a'.repeat(32)

describe('static site directory authentication', () => {
	test('accepts only the exact configured bearer token', () => {
		expect(
			isSiteDirectoryRequestAuthorized(
				new Request('http://app/internal', { headers: { authorization: `Bearer ${token}` } }),
				token
			)
		).toBe(true)
		expect(
			isSiteDirectoryRequestAuthorized(
				new Request('http://app/internal', {
					headers: { authorization: `Bearer ${'b'.repeat(32)}` }
				}),
				token
			)
		).toBe(false)
	})

	test('fails closed when the token or authorization header is absent', () => {
		expect(isSiteDirectoryRequestAuthorized(new Request('http://app/internal'), token)).toBe(false)
		expect(isSiteDirectoryRequestAuthorized(new Request('http://app/internal'))).toBe(false)
	})
})
