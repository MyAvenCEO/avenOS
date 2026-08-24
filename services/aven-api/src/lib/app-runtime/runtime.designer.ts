import { readable } from 'svelte/store'
import { passkeyRegistrationDiagnostic } from '$lib/passkey-diagnostics.js'
import type { MetaInfo, NameAvailability, NameHoldResult } from '$lib/types.js'
import type { AppRuntime } from './contract.js'
import { scenario } from './designer-scenarios.js'

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
			const diagnostic =
				state === 'firefox-error'
					? passkeyRegistrationDiagnostic(
							{
								code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
								message: 'The operation either timed out or was not allowed.',
								status: 400
							},
							{ firefoxLinux: true, android: false }
						).message
					: state === 'android-error'
						? passkeyRegistrationDiagnostic(
								{
									code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY',
									message: 'The service could not complete the request',
									status: 400
								},
								{ firefoxLinux: false, android: true }
							).message
						: ''
			return {
				name: ['waiting', 'error', 'firefox-error', 'android-error'].includes(state)
					? 'MacBook Touch ID'
					: '',
				busy: state === 'waiting',
				error:
					diagnostic ||
					(state === 'unsupported'
						? 'Passkeys unavailable.'
						: state === 'error'
							? 'Passkey creation failed.'
							: '')
			}
		},
		checkout(url) {
			const state = scenario(url, 'polar-loading')
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
		check: async (name) =>
			name.trim().toLowerCase() === 'taken' ? unavailable() : available(name),
		loadInfo: async (name, current) => current ?? (name ? available(name) : null),
		mine: async () => ['aurora'],
		hold: async (name) => hold(name)
	},
	auth: {
		signIn: async () => {},
		signOut: async () => {},
		createPasskey: async () => {},
		passkeyWarning: (url) => ['firefox', 'firefox-error'].includes(scenario(url, 'default'))
	},
	device: { approve: async () => {} },
	dashboard: {
		async load(url) {
			const state = scenario(url, 'loading')
			if (state === 'loading') return never()
			if (state === 'error') throw new Error('Download information could not be loaded.')
			return { downloadUrl: '#designer-download', needsPasskey: false }
		},
		// Fixture, not a forecast. Real numbers arrive when the backend does;
		// this exists so the panel can be designed against something.
		async queue() {
			return {
				name: 'aurora',
				reservedAt: '2026-08-14T09:12:00.000Z',
				position: 137,
				ahead: 136,
				total: 412,
				invited: 84,
				lastInvitedAt: '2026-08-19T16:40:00.000Z',
				board: [
					{ position: 134, name: 'kestrel', reservedAt: '2026-08-14T08:02:00.000Z', invited: true },
					{ position: 135, name: 'lumen', reservedAt: '2026-08-14T08:31:00.000Z', invited: false },
					{ position: 136, name: 'fjord', reservedAt: '2026-08-14T08:58:00.000Z', invited: false },
					{
						position: 137,
						name: 'aurora',
						reservedAt: '2026-08-14T09:12:00.000Z',
						invited: false,
						you: true
					},
					{
						position: 138,
						name: 'tessera',
						reservedAt: '2026-08-14T09:40:00.000Z',
						invited: false
					},
					{
						position: 139,
						name: 'nordlicht',
						reservedAt: '2026-08-14T10:05:00.000Z',
						invited: false
					},
					{ position: 140, name: 'salz', reservedAt: '2026-08-14T11:19:00.000Z', invited: false }
				],
				latest: [
					{
						position: 412,
						name: 'wolkenbau',
						reservedAt: '2026-08-21T14:22:00.000Z',
						invited: false
					},
					{ position: 411, name: 'mira', reservedAt: '2026-08-21T11:03:00.000Z', invited: false },
					{ position: 410, name: 'hafen', reservedAt: '2026-08-20T19:47:00.000Z', invited: false },
					{
						position: 409,
						name: 'zinnober',
						reservedAt: '2026-08-20T16:12:00.000Z',
						invited: false
					},
					{ position: 408, name: 'kolibri', reservedAt: '2026-08-20T09:35:00.000Z', invited: false }
				]
			}
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
