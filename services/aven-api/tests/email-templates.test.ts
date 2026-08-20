import { describe, expect, it } from 'vitest'
import { renderEmail } from '../src/lib/server/email/templates.js'

describe('email copy', () => {
	it('labels checkout and setup actions directly', () => {
		const checkout = renderEmail('name.purchase-link', {
			name: 'alice',
			claimUrl: 'https://id.example/checkout',
			expiresAt: 'Thursday'
		})
		expect(checkout.subject).toBe('Checkout link for alice')
		expect(checkout.text).toBe(
			'Name: alice\nContinue to checkout: https://id.example/checkout\nLink expires: Thursday'
		)
		expect(checkout.html).toContain('>Continue to checkout</a>')

		const login = renderEmail('name.purchased', {
			name: 'alice',
			accessUrl: 'https://id.example/setup'
		})
		expect(login.subject).toBe('Login for alice')
		expect(login.text).toBe(
			'Name: alice\nCreate passkey: https://id.example/setup\nLogin: https://id.example/setup\nThis link works until a passkey is created.'
		)
		expect(login.html).toContain('>Create passkey</a>')
		expect(login.html).toContain('>Login</a>')
	})
})
