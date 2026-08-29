import { json } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { building } from '$app/environment'
import { ProofOfWorkError, protectedAuthPaths } from '$lib/server/proof-of-work.js'
import { runtime } from '$lib/server/runtime.js'

export const handle = async ({ event, resolve }) => {
	if (building) return resolve(event)
	const { auth, config, proofOfWork } = await runtime()
	const origin = event.request.headers.get('origin')
	const allowedOrigins = new Set([
		config.PUBLIC_BASE_URL,
		...config.TRUSTED_WEB_ORIGINS.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	])
	const normalizedPath = event.url.pathname.replace(/\/$/, '')
	const publicDeviceExchange =
		normalizedPath === '/api/auth/device/code' || normalizedPath === '/api/auth/device/token'
	if (
		event.url.pathname.startsWith('/api/') &&
		!publicDeviceExchange &&
		!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method) &&
		(!origin || !allowedOrigins.has(origin))
	)
		return json(
			{ code: 'ORIGIN_NOT_ALLOWED', message: 'The request origin is not allowed.' },
			{ status: 403 }
		)
	if (event.request.method === 'OPTIONS' && origin && allowedOrigins.has(origin)) {
		return new Response(null, {
			status: 204,
			headers: {
				'access-control-allow-origin': origin,
				'access-control-allow-credentials': 'true',
				'access-control-allow-methods': 'GET,POST,OPTIONS',
				'access-control-allow-headers': 'content-type,x-proof-of-work'
			}
		})
	}
	if (event.request.method === 'POST' && protectedAuthPaths.has(event.url.pathname)) {
		try {
			await proofOfWork.verifyAndConsume(event.request.headers.get('x-proof-of-work'))
		} catch (error) {
			if (error instanceof ProofOfWorkError)
				return json({ code: error.code, message: error.message }, { status: 403 })
			throw error
		}
	}
	const response = await svelteKitHandler({ event, resolve, auth, building })
	response.headers.set('x-content-type-options', 'nosniff')
	response.headers.set('referrer-policy', 'no-referrer')
	response.headers.set('x-frame-options', 'DENY')
	if (event.url.pathname.startsWith('/api/')) response.headers.set('cache-control', 'no-store')
	if (origin && allowedOrigins.has(origin)) {
		response.headers.set('access-control-allow-origin', origin)
		response.headers.set('access-control-allow-credentials', 'true')
		response.headers.append('vary', 'Origin')
	}
	return response
}
