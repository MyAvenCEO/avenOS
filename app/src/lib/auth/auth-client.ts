import { createAuthClient } from 'better-auth/svelte'

/**
 * Client for the self-hosted Better Auth server (libs/betterauth). Points at
 * PUBLIC_BETTER_AUTH_URL (the auth server origin, e.g. http://localhost:8787) — a
 * different origin than the app. board 0050.
 *
 * Bearer token: the Tauri WebView (WKWebView) drops the cross-site session cookie, so
 * we also support token auth. The server's `bearer` plugin returns a token in the
 * `set-auth-token` response header after sign-in; we persist it and send it as
 * `Authorization: Bearer …` on every request. Browsers keep working via cookies too;
 * the token is simply belt-and-suspenders there.
 */
const BEARER_KEY = 'avenos.auth.bearer'

function storedToken(): string {
	if (typeof localStorage === 'undefined') return ''
	return localStorage.getItem(BEARER_KEY) ?? ''
}

/** The persisted bearer token, for authenticating direct calls to the server (e.g. the AI proxy). */
export function getBearerToken(): string {
	return storedToken()
}

export function setBearerToken(token: string | null): void {
	if (typeof localStorage === 'undefined') return
	if (token) localStorage.setItem(BEARER_KEY, token)
	else localStorage.removeItem(BEARER_KEY)
}

export const authClient = createAuthClient({
	baseURL: import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined,
	fetchOptions: {
		auth: {
			type: 'Bearer',
			token: () => storedToken()
		},
		onSuccess: (ctx) => {
			const token = ctx.response.headers.get('set-auth-token')
			if (token) setBearerToken(token)
		}
	}
})
