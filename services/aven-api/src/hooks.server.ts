import { type Handle, json } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { building } from '$app/environment'
import { ProofOfWorkError, protectedAuthPaths } from '$lib/server/proof-of-work.js'
import { runtime } from '$lib/server/runtime.js'

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event)
	const { pathname } = event.url
	if (pathname === '/.well-known/apple-app-site-association') {
		const response = await resolve(event)
		response.headers.set('Cache-Control', 'public, max-age=3600')
		response.headers.set('X-Content-Type-Options', 'nosniff')
		return response
	}
	const { auth, proofOfWork, config, names } = await runtime()

	// The origin check is CSRF protection: it defends endpoints that trust an
	// ambient session cookie. Service-to-service endpoints carry their own
	// credential (a webhook signature, a client token), are never reached from
	// a browser, and must ignore cookies entirely — an Origin header would be
	// meaningless there, and demanding one just breaks them.
	const serviceAuthenticated = pathname.startsWith('/api/webhooks/')
	if (
		pathname.startsWith('/api/') &&
		!serviceAuthenticated &&
		!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
	) {
		const origin = event.request.headers.get('origin')
		if (
			origin !== config.PUBLIC_BASE_URL &&
			!(config.NODE_ENV === 'development' && origin === event.url.origin)
		) {
			return json(
				{ code: 'ORIGIN_NOT_ALLOWED', message: 'The request origin is not allowed.' },
				{ status: 403 }
			)
		}
	}

	const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
	const powPurpose = protectedAuthPaths.get(normalizedPath)
	if (powPurpose && event.request.method === 'POST') {
		try {
			await proofOfWork.verifyAndConsume(
				powPurpose,
				event.request.headers.get('x-proof-of-work') ?? undefined
			)
		} catch (error) {
			if (error instanceof ProofOfWorkError)
				return json({ code: error.code, message: error.message }, { status: 403 })
			throw error
		}
	}

	// A passkey is created for a purchased name: registration is refused
	// until the account owns one.
	if (
		normalizedPath === '/api/auth/passkey/generate-register-options' ||
		normalizedPath === '/api/auth/passkey/verify-registration'
	) {
		const session = await auth.api.getSession({ headers: event.request.headers })
		if (!session || !(await names.ownsAny(session.user.id))) {
			return json({ code: 'NAME_REQUIRED', message: 'Purchase a name first.' }, { status: 403 })
		}
	}

	const response = await svelteKitHandler({ event, resolve, auth, building })
	// API answers are dynamic and may carry identity or checkout state.
	if (pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store')
	response.headers.set('X-Content-Type-Options', 'nosniff')
	response.headers.set('Referrer-Policy', 'same-origin')
	response.headers.set('X-Frame-Options', 'DENY')
	return response
}
