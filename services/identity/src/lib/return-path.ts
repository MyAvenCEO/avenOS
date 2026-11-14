// /login may send the browser back to exactly one place: a pending OIDC authorization
// request on this origin. Anything else (other paths, other origins, protocol-relative or
// backslash tricks, control characters) falls back to the dashboard.
export const LOGIN_RETURN_PARAM = 'returnTo'
const RETURN_PATHS = new Set(['/api/auth/oauth2/authorize'])

export function safeReturnPath(value: string | null | undefined, origin: string): string | null {
	if (!value || value.length > 4096 || !value.startsWith('/') || value.startsWith('//')) return null
	if (/[\\\p{Cc}]/u.test(value)) return null
	let url: URL
	try {
		url = new URL(value, origin)
	} catch {
		return null
	}
	if (url.origin !== new URL(origin).origin || !RETURN_PATHS.has(url.pathname) || url.hash)
		return null
	return `${url.pathname}${url.search}`
}
