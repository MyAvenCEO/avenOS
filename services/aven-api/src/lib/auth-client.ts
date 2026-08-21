import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/svelte'
import { passkeyProcessTrace } from '$lib/passkey-diagnostics.js'
import { createProofOfWorkHeader } from '$lib/proof-of-work.js'

// Sign-in endpoints are proof-of-work gated server-side. Solving takes
// ~200ms, so it happens transparently here, just in time for each request —
// pages never deal with challenge plumbing or show "computing…" states.
const protectedPaths = ['/passkey/verify-authentication']
const registrationEndpoints = new Map<string, 'registration-options' | 'registration-verification'>(
	[
		['/passkey/generate-register-options', 'registration-options'],
		['/passkey/verify-registration', 'registration-verification']
	]
)

async function powFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url =
		typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
	const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
	const registrationEndpoint = [...registrationEndpoints].find(([path]) => url.includes(path))?.[1]
	const startedAt = Date.now()
	if (registrationEndpoint) {
		passkeyProcessTrace('HTTP request', {
			endpoint: registrationEndpoint,
			method: method === 'POST' ? 'POST' : 'GET'
		})
	}
	if (method === 'POST' && protectedPaths.some((path) => url.includes(path))) {
		const proof = await createProofOfWorkHeader('sign-in')
		const proofValue = proof['x-proof-of-work']
		if (!proofValue) throw new Error('Proof-of-work did not return a sign-in proof.')
		const headers = new Headers(init?.headers)
		headers.set('x-proof-of-work', proofValue)
		init = { ...init, headers }
	}
	try {
		const response = await fetch(input, init)
		if (registrationEndpoint) {
			passkeyProcessTrace('HTTP response', {
				endpoint: registrationEndpoint,
				method: method === 'POST' ? 'POST' : 'GET',
				status: response.status,
				durationMs: Date.now() - startedAt
			})
		}
		return response
	} catch (error) {
		if (registrationEndpoint) {
			console.error('[passkey] HTTP request failed', {
				endpoint: registrationEndpoint,
				method: method === 'POST' ? 'POST' : 'GET',
				durationMs: Date.now() - startedAt,
				errorName: error instanceof Error ? error.name : 'UnknownError'
			})
		}
		throw error
	}
}

export const authClient = createAuthClient({
	fetchOptions: { customFetchImpl: powFetch },
	plugins: [passkeyClient()]
})
