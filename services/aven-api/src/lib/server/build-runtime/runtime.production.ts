import { error as httpError, json, redirect } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { building } from '$app/environment'
import { AppError } from '$lib/server/errors.js'
import { ProofOfWorkError, protectedAuthPaths } from '$lib/server/proof-of-work.js'
import { rateLimit } from '$lib/server/rate-limit.js'
import { runtime } from '$lib/server/runtime.js'
import type { ServerBuildRuntime } from './contract.js'

export const serverBuildRuntime: ServerBuildRuntime = {
	async handle({ event, resolve }) {
		if (building) return resolve(event)
		const { pathname } = event.url
		if (pathname === '/.well-known/apple-app-site-association') {
			const response = await resolve(event)
			response.headers.set('Cache-Control', 'public, max-age=3600')
			response.headers.set('X-Content-Type-Options', 'nosniff')
			return response
		}
		const { auth, proofOfWork, config, names } = await runtime()
		const normalizedPath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

		// Browser mutations rely on the ambient session cookie, while service and
		// native-client endpoints authenticate their own requests.
		const serviceAuthenticated = pathname.startsWith('/api/webhooks/')
		const publicDeviceExchange =
			normalizedPath === '/api/auth/device/code' || normalizedPath === '/api/auth/device/token'
		if (
			pathname.startsWith('/api/') &&
			!serviceAuthenticated &&
			!publicDeviceExchange &&
			!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)
		) {
			const origin = event.request.headers.get('origin')
			const browserOriginAllowed =
				origin === config.PUBLIC_BASE_URL ||
				(config.NODE_ENV === 'development' && origin === event.url.origin)
			if (!browserOriginAllowed) {
				const bearerSession = event.request.headers.get('authorization')?.startsWith('Bearer ')
					? await auth.api.getSession({ headers: event.request.headers })
					: null
				if (!bearerSession) {
					return json(
						{ code: 'ORIGIN_NOT_ALLOWED', message: 'The request origin is not allowed.' },
						{ status: 403 }
					)
				}
			}
		}

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

		if (normalizedPath === '/api/auth/device/approve' && event.request.method === 'POST') {
			const session = await auth.api.getSession({ headers: event.request.headers })
			if (!session || !(await names.ownsAny(session.user.id))) {
				return json({ code: 'NAME_REQUIRED', message: 'Purchase a name first.' }, { status: 403 })
			}
		}

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
		if (pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'no-store')
		response.headers.set('X-Content-Type-Options', 'nosniff')
		response.headers.set('Referrer-Policy', 'same-origin')
		response.headers.set('X-Frame-Options', 'DENY')
		return response
	},
	async loadCheckout(event) {
		if (!rateLimit(`names-claim:${event.getClientAddress()}`, 20, 60_000))
			redirect(303, '/purchase/expired')

		const { names, payments, config } = await runtime()
		try {
			const checkout = await names.claim(event.url.searchParams.get('token') ?? '')
			return {
				...checkout,
				provider: payments.kind,
				priceEur: config.NAME_PRICE_EUR,
				reservationMinutes: config.NAME_RESERVATION_TTL_MINUTES
			}
		} catch (error) {
			if (!(error instanceof AppError)) throw error
			if (error.status >= 500) httpError(error.status, { message: error.message })
			redirect(303, '/purchase/expired')
		}
	}
}
