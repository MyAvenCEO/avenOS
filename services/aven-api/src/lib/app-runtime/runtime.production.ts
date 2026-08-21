import { derived, type Readable } from 'svelte/store'
import { api } from '$lib/api.js'
import { authClient } from '$lib/auth-client.js'
import { createProofOfWorkHeader } from '$lib/proof-of-work.js'
import type { MetaInfo, NameAvailability, NameHoldResult, PasskeyStatus } from '$lib/types.js'
import type { AppRuntime, AppSession } from './contract.js'

let sessionStore: Readable<AppSession> | undefined

function responseJson(response: Response): Promise<Record<string, unknown>> {
	return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

async function deviceResponse(response: Response): Promise<Record<string, unknown>> {
	const body = await responseJson(response)
	if (!response.ok) {
		throw new Error(
			typeof body.message === 'string'
				? body.message
				: typeof body.error_description === 'string'
					? body.error_description
					: 'Device authorization failed.'
		)
	}
	return body
}

export const appRuntime: AppRuntime = {
	session() {
		if (!sessionStore) {
			const authSession = authClient.useSession()
			sessionStore = derived(authSession, ($session) => ({
				authenticated: Boolean($session.data),
				...($session.data?.user
					? {
							user: {
								name: $session.data.user.name,
								email: $session.data.user.email
							}
						}
					: {})
			}))
		}
		return sessionStore
	},
	initial: {
		nameSearch: () => ({ name: '', busy: false, result: null, error: '' }),
		secureName: (url) => ({
			name: (url.searchParams.get('name') ?? '').toLowerCase(),
			email: '',
			info: null,
			hold: null,
			loading: false,
			error: ''
		}),
		login: (url) => ({
			busy: false,
			error: '',
			message:
				url.searchParams.get('access') === 'invalid'
					? 'Link unavailable. Sign in with a passkey.'
					: ''
		}),
		device: () => ({ signedIn: false, busy: false, approved: false, message: '' }),
		passkey: () => ({ name: '', busy: false, error: '' }),
		checkout: () => ({ state: 'loading', error: '' }),
		payment: () => ({ busy: false, error: '' })
	},
	names: {
		check: (name) =>
			api<NameAvailability>(`/names/check?name=${encodeURIComponent(name.trim().toLowerCase())}`),
		loadInfo: (name) =>
			name
				? api<NameAvailability>(`/names/check?name=${encodeURIComponent(name)}`).catch(() => null)
				: Promise.resolve(null),
		async hold(name, email, origin) {
			const headers = await createProofOfWorkHeader('secure-name')
			const result = await api<{ hold: NameHoldResult }>('/names/hold', {
				method: 'POST',
				headers,
				body: JSON.stringify({ name, email, ...origin })
			})
			return result.hold
		}
	},
	auth: {
		async signIn() {
			const result = await authClient.signIn.passkey()
			if (result?.error) throw new Error(result.error.message ?? 'Login failed.')
		},
		async signOut() {
			await authClient.signOut()
		},
		async createPasskey(name, firefoxLinux) {
			if (!window.PublicKeyCredential) throw new Error('Passkeys unavailable.')
			const meta = await api<MetaInfo>('/meta')
			const result = await authClient.passkey.addPasskey({
				name: name.trim() || undefined,
				...(meta.requirePasskeyPrf
					? { extensions: { prf: {} } as never, returnWebAuthnResponse: true }
					: {})
			})
			if (result?.error) {
				if (
					firefoxLinux &&
					'code' in result.error &&
					result.error.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
				) {
					throw new Error(
						'Firefox on Linux could not access a passkey provider. Connect a FIDO2 security key or open the original setup link on a browser or device with a passkey provider.'
					)
				}
				throw new Error(result.error.message ?? 'Passkey creation failed.')
			}
			const extensions = (
				'webauthn' in result ? result.webauthn.clientExtensionResults : undefined
			) as { prf?: { enabled?: boolean } } | undefined
			const data = result?.data as Record<string, unknown> | undefined
			await api('/passkeys', {
				method: 'POST',
				body: JSON.stringify({
					credentialId: typeof data?.id === 'string' ? data.id : undefined,
					prfEnabled: extensions?.prf?.enabled === true
				})
			})
		},
		passkeyWarning: () => /Firefox\//.test(navigator.userAgent) && /Linux/.test(navigator.userAgent)
	},
	device: {
		async approve(userCode) {
			await deviceResponse(
				await fetch(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
					credentials: 'same-origin'
				})
			)
			await deviceResponse(
				await fetch('/api/auth/device/approve', {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ userCode })
				})
			)
		}
	},
	dashboard: {
		async load() {
			const [status, meta] = await Promise.all([
				api<PasskeyStatus>('/passkeys'),
				api<MetaInfo>('/meta')
			])
			return {
				downloadUrl: meta.downloadUrl,
				needsPasskey: !status.passkeys.some(
					(passkey) => !meta.requirePasskeyPrf || passkey.prf_enabled
				)
			}
		}
	},
	billing: {
		pay: (input) =>
			api<{ paid: boolean; redirect: string }>('/billing/fake-pay', {
				method: 'POST',
				body: JSON.stringify(input)
			})
	},
	purchase: {
		async waitForSession(token) {
			const deadline = Date.now() + 60_000
			while (token && Date.now() <= deadline) {
				try {
					const response = await fetch('/api/auth/sign-in/purchase-token', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ token })
					})
					if (response.ok) return true
				} catch {
					/* keep polling until the deadline */
				}
				await new Promise((resolve) => setTimeout(resolve, 1500))
			}
			return false
		}
	},
	meta: () => api<MetaInfo>('/meta')
}
