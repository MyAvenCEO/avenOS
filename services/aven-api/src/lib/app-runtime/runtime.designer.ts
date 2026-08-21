import { readable } from 'svelte/store'
import { scenario } from './designer-scenarios.js'
import type { AppRuntime } from './contract.js'
import type { MetaInfo, NameAvailability, NameHoldResult } from '$lib/types.js'

const meta: MetaInfo = {
	priceEur: 25,
	downloadUrl: '#designer-download',
	requirePasskeyPrf: true
}

const available = (name = 'aurora'): NameAvailability => ({
	name,
	available: true,
	priceEur: 25,
	reservationMinutes: 15
})

const unavailable = (name = 'taken'): NameAvailability => ({
	name,
	available: false,
	reason: 'NAME_TAKEN',
	priceEur: 25,
	reservationMinutes: 15
})

const hold = (name = 'aurora'): NameHoldResult => ({
	name,
	expiresAt: '2026-08-21T15:30:00.000Z',
	priceEur: 25,
	reservationMinutes: 15
})

function authenticatedByDefault(url: URL): boolean {
	const selected = url.searchParams.get('session')
	if (selected) return selected === 'authenticated'
	if (url.pathname === '/device') {
		return !['signed-out', 'signing-in', 'missing'].includes(scenario(url, 'signed-out'))
	}
	return ['/dashboard', '/passkey/create'].includes(url.pathname)
}

function never<T>(): Promise<T> {
	return new Promise(() => {})
}

export const appRuntime: AppRuntime = {
	session: (url) =>
		readable({
			authenticated: authenticatedByDefault(url),
			user: { name: 'Alex Morgan', email: 'alex@example.com' }
		}),
	initial: {
		nameSearch(url) {
			switch (scenario(url, 'empty')) {
				case 'empty':
					return { name: '', busy: false, result: null, error: '' }
				case 'checking':
					return { name: 'aurora', busy: true, result: null, error: '' }
				case 'unavailable':
					return { name: 'taken', busy: false, result: unavailable(), error: '' }
				case 'error':
					return { name: 'aurora', busy: false, result: null, error: 'Name check failed.' }
				default:
					return { name: 'aurora', busy: false, result: available(), error: '' }
			}
		},
		secureName(url) {
			const state = scenario(url, 'form')
			const name = (url.searchParams.get('name') ?? '').toLowerCase()
			return {
				name,
				email: ['sending', 'sent', 'error'].includes(state) ? 'alex@example.com' : '',
				info: state === 'unavailable' ? unavailable(name) : name ? available(name) : null,
				hold: state === 'sent' ? hold(name) : null,
				loading: state === 'sending',
				error: state === 'error' ? 'Checkout link could not be sent.' : ''
			}
		},
		login(url) {
			const state = scenario(url, 'default')
			return {
				busy: state === 'waiting',
				error: '',
				message:
					state === 'invalid'
						? 'Link unavailable. Sign in with a passkey.'
						: state === 'error'
							? 'Passkey authentication failed.'
							: ''
			}
		},
		device(url) {
			const state = scenario(url, 'signed-out')
			return {
				signedIn: ['approval', 'approving', 'approved', 'error'].includes(state),
				busy: ['signing-in', 'approving'].includes(state),
				approved: state === 'approved',
				message: state === 'error' ? 'This device request is no longer valid.' : ''
			}
		},
		passkey(url) {
			const state = scenario(url, 'default')
			return {
				name: ['waiting', 'error'].includes(state) ? 'MacBook Touch ID' : '',
				busy: state === 'waiting',
				error:
					state === 'unsupported'
						? 'Passkeys unavailable.'
						: state === 'error'
							? 'Passkey creation failed.'
							: ''
			}
		},
		checkout(url) {
			const state = scenario(url, 'creem-loading')
			return {
				state: state.includes('paying')
					? 'paying'
					: state.includes('confirming')
						? 'confirming'
						: state.includes('loading')
							? 'loading'
							: 'ready',
				error: state.endsWith('error') ? 'Payment failed.' : ''
			}
		},
		payment(url) {
			const state = scenario(url, 'ready')
			return {
				busy: state === 'processing',
				error: state === 'error' ? 'Payment failed.' : ''
			}
		}
	},
	names: {
		check: async (name) => (name.trim().toLowerCase() === 'taken' ? unavailable() : available(name)),
		loadInfo: async (name, current) => current ?? (name ? available(name) : null),
		hold: async (name) => hold(name)
	},
	auth: {
		signIn: async () => {},
		signOut: async () => {},
		createPasskey: async () => {},
		passkeyWarning: (url) => scenario(url, 'default') === 'firefox'
	},
	device: { approve: async () => {} },
	dashboard: {
		async load(url) {
			const state = scenario(url, 'loading')
			if (state === 'loading') return never()
			if (state === 'error') throw new Error('Download information could not be loaded.')
			return { downloadUrl: '#designer-download', needsPasskey: false }
		}
	},
	billing: {
		async pay(input) {
			return {
				redirect: `/purchase/success?name=${encodeURIComponent(input.name || 'aurora')}&pt=designer&scenario=confirming`
			}
		}
	},
	purchase: {
		waitForSession: async (_token, url) =>
			scenario(url, 'confirming') === 'fallback' ? false : never()
	},
	meta: async () => meta
}
