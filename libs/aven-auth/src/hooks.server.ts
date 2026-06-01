import type { Handle } from '@sveltejs/kit'
import { svelteKitHandler } from 'better-auth/svelte-kit'
import { building } from '$app/environment'
import { auth } from '$lib/auth'

/**
 * The Tauri app loads from a different origin than the auth server (e.g. the dev
 * webview on `http://127.0.0.1:1420`, or `tauri://localhost` in a release build) and
 * calls `/api/auth/*` with `credentials: 'include'`. That needs explicit CORS:
 * a preflight (OPTIONS) response plus `Access-Control-Allow-Credentials` on each reply,
 * with `Allow-Origin` echoing the *exact* caller origin (wildcards are illegal with
 * credentials). Better Auth's `trustedOrigins` covers CSRF, not these CORS headers.
 */
const STATIC_ALLOWED_ORIGINS = new Set(['tauri://localhost', 'https://tauri.localhost'])

/** Dev webviews / Vite — localhost or 127.0.0.1 on any port. */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function isAllowedOrigin(origin: string | null): origin is string {
	if (!origin) return false
	return STATIC_ALLOWED_ORIGINS.has(origin) || LOCAL_ORIGIN.test(origin)
}

function corsHeaders(origin: string): Record<string, string> {
	return {
		'access-control-allow-origin': origin,
		'access-control-allow-credentials': 'true',
		'access-control-allow-methods': 'GET, POST, OPTIONS',
		'access-control-allow-headers': 'content-type, authorization',
		'access-control-max-age': '600',
		vary: 'origin'
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const origin = event.request.headers.get('origin')
	const isAuthApi = event.url.pathname.startsWith('/api/auth')

	// Preflight: answer here — Better Auth's handler 404s on OPTIONS.
	if (isAuthApi && event.request.method === 'OPTIONS' && isAllowedOrigin(origin)) {
		return new Response(null, { status: 204, headers: corsHeaders(origin) })
	}

	const response = await svelteKitHandler({ event, resolve, auth, building })

	if (isAuthApi && isAllowedOrigin(origin)) {
		for (const [key, value] of Object.entries(corsHeaders(origin))) {
			response.headers.set(key, value)
		}
	}
	return response
}
