import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/svelte'
import { createProofOfWorkHeader } from '$lib/proof-of-work.js'

// Sign-in endpoints are proof-of-work gated server-side. Solving takes
// ~200ms, so it happens transparently here, just in time for each request —
// pages never deal with challenge plumbing or show "computing…" states.
const protectedPaths = ['/passkey/verify-authentication']

async function powFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const url =
		typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
	if (
		(init?.method ?? 'GET').toUpperCase() === 'POST' &&
		protectedPaths.some((path) => url.includes(path))
	) {
		const proof = await createProofOfWorkHeader('sign-in')
		const headers = new Headers(init?.headers)
		headers.set('x-proof-of-work', proof['x-proof-of-work']!)
		init = { ...init, headers }
	}
	return fetch(input, init)
}

export const authClient = createAuthClient({
	fetchOptions: { customFetchImpl: powFetch },
	plugins: [passkeyClient()]
})
