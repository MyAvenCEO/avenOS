import { json } from '@sveltejs/kit'
import { LOGIN_RETURN_PARAM } from '../return-path.js'
import type { IdentityConfig } from './config.js'
import type { Queryable } from './db.js'

// OpenID Connect authorization-code + PKCE for relying parties registered in OIDC_CLIENTS.
// Better Auth's oidc-provider plugin issues codes and tokens; this module is the policy in
// front of it: exact client/redirect matching, S256 only, openid/profile/email only, no
// refresh tokens, and a code only for a real passkey session.
export const OIDC_SCOPES = ['openid', 'profile', 'email'] as const
export const OIDC_PATHS = {
	authorize: '/api/auth/oauth2/authorize',
	token: '/api/auth/oauth2/token',
	userinfo: '/api/auth/oauth2/userinfo',
	jwks: '/api/auth/jwks',
	discovery: '/.well-known/openid-configuration'
} as const
export const OIDC_CODE_SECONDS = 120

// The plugin resumes a pending authorization from these signed cookies after any response
// that sets a session cookie — including setup-link sessions. Identity never lets the plugin
// set them, and strips any that arrive, so only the gate below can lead to a code.
const pluginResumeCookies = ['oidc_login_prompt', 'oidc_consent_prompt']
const openPluginPaths = new Set<string>([
	OIDC_PATHS.authorize,
	OIDC_PATHS.token,
	OIDC_PATHS.userinfo
])
const pkceChallenge = /^[A-Za-z0-9_-]{43}$/
const pkceVerifier = /^[A-Za-z0-9._~-]{43,128}$/
const printable = /^[\x20-\x7e]*$/

export function trustedOidcClients(config: IdentityConfig) {
	return config.OIDC_CLIENTS.map((client) => ({
		clientId: client.client_id,
		name: client.name,
		type: 'public' as const,
		disabled: false,
		metadata: null,
		redirectUrls: client.redirect_uris,
		skipConsent: true
	}))
}

export function oidcCorsOrigins(config: IdentityConfig): Set<string> {
	return new Set(
		config.OIDC_CLIENTS.flatMap((client) => client.redirect_uris.map((uri) => new URL(uri).origin))
	)
}

/** Public, cookie-free OIDC endpoints that relying-party origins may call from a browser. */
export function isOidcCorsPath(pathname: string): boolean {
	return (
		pathname === OIDC_PATHS.token ||
		pathname === OIDC_PATHS.userinfo ||
		pathname === OIDC_PATHS.jwks ||
		pathname === OIDC_PATHS.discovery
	)
}

export function stripPluginResumeCookies(request: Request): Request {
	const cookie = request.headers.get('cookie')
	if (!cookie) return request
	const kept = cookie
		.split(';')
		.map((part) => part.trim())
		.filter((part) => {
			const name = part.split('=')[0]?.trim() ?? ''
			return !pluginResumeCookies.some(
				(blocked) => name === blocked || name.endsWith(`-${blocked}`)
			)
		})
	if (kept.length === cookie.split(';').length) return request
	const headers = new Headers(request.headers)
	if (kept.length) headers.set('cookie', kept.join('; '))
	else headers.delete('cookie')
	return new Request(request, { headers })
}

/** Removes one bounded batch of expired OIDC access-token rows. */
export async function cleanupOidcTokens(pool: Queryable): Promise<number> {
	const result = await pool.query(
		`DELETE FROM oauth_access_token WHERE id IN (SELECT id FROM oauth_access_token
		 WHERE refresh_token_expires_at < now() AND access_token_expires_at < now() LIMIT 1000)`
	)
	return result.rowCount ?? 0
}

/** Same rule as the service JWT `amr`: a non-setup session of an account that holds a passkey. */
export async function isPasskeySession(
	pool: Queryable,
	sessionId: string,
	userId: string
): Promise<boolean> {
	const result = await pool.query(
		`SELECT 1 FROM session s JOIN passkey p ON p.user_id=s.user_id
		 WHERE s.id=$1 AND s.user_id=$2 AND s.expires_at > now()
		 AND s.setup_token_hash IS NULL LIMIT 1`,
		[sessionId, userId]
	)
	return result.rows.length > 0
}

type SessionLookup = (
	headers: Headers
) => Promise<{ session: { id: string; createdAt: Date }; user: { id: string } } | null>

export interface OidcGateInput {
	request: Request
	config: IdentityConfig
	pool: Queryable
	getSession: SessionLookup
	now?: number
}

const oauthError = (status: number, error: string, description: string) =>
	json({ error, error_description: description }, { status })

function redirect(location: string): Response {
	return new Response(null, { status: 302, headers: { location } })
}

/**
 * Applies identity policy to OIDC requests. Returns a Response to send immediately, or the
 * Request (possibly rewritten) to hand to Better Auth.
 */
export async function oidcGate(input: OidcGateInput): Promise<Request | Response> {
	const url = new URL(input.request.url)
	if (!url.pathname.startsWith('/api/auth/')) return input.request
	const request = stripPluginResumeCookies(input.request)
	const path = url.pathname.replace(/\/$/, '')
	// Registration, consent, client lookup, logout and the plugin's own discovery document are
	// closed: clients are configuration, and /.well-known/openid-configuration is the source.
	if (
		(path.startsWith('/api/auth/oauth2/') && !openPluginPaths.has(path)) ||
		path === '/api/auth/.well-known/openid-configuration'
	)
		return json({ code: 'NOT_FOUND' }, { status: 404 })
	if (path === OIDC_PATHS.authorize) return authorize({ ...input, request }, url)
	if (path === OIDC_PATHS.token) return token({ ...input, request })
	return request
}

async function authorize(input: OidcGateInput, url: URL): Promise<Request | Response> {
	if (input.request.method !== 'GET')
		return oauthError(405, 'invalid_request', 'Use GET for authorization requests.')
	const params = url.searchParams
	const keys = [...params.keys()]
	if (new Set(keys).size !== keys.length)
		return oauthError(400, 'invalid_request', 'Authorization parameters must not repeat.')
	const clientId = params.get('client_id') ?? ''
	const redirectUri = params.get('redirect_uri') ?? ''
	const client = input.config.OIDC_CLIENTS.find((candidate) => candidate.client_id === clientId)
	// Without a registered client and exact redirect URI there is nowhere safe to send errors.
	if (!client) return oauthError(400, 'invalid_client', 'The client is not registered.')
	if (!client.redirect_uris.includes(redirectUri))
		return oauthError(400, 'invalid_request', 'The redirect_uri is not registered for this client.')
	const state = params.get('state')
	const fail = (error: string, description: string) => {
		const target = new URL(redirectUri)
		target.searchParams.set('error', error)
		target.searchParams.set('error_description', description)
		if (state && state.length <= 512 && printable.test(state))
			target.searchParams.set('state', state)
		return redirect(target.href)
	}
	if (!state || state.length > 512 || !printable.test(state))
		return fail('invalid_request', 'state is required.')
	if (params.has('request') || params.has('request_uri'))
		return fail('request_not_supported', 'Request objects are not supported.')
	if (params.get('response_type') !== 'code')
		return fail('unsupported_response_type', 'Only response_type=code is supported.')
	if (params.has('response_mode') && params.get('response_mode') !== 'query')
		return fail('invalid_request', 'Only response_mode=query is supported.')
	const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
	if (
		!scopes.includes('openid') ||
		scopes.some((scope) => !(OIDC_SCOPES as readonly string[]).includes(scope))
	)
		return fail('invalid_scope', 'Request openid, optionally with profile and email.')
	if (params.get('code_challenge_method') !== 'S256')
		return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.')
	if (!pkceChallenge.test(params.get('code_challenge') ?? ''))
		return fail('invalid_request', 'code_challenge must be a base64url SHA-256 digest.')
	const nonce = params.get('nonce')
	if (nonce !== null && (!nonce || nonce.length > 512 || !printable.test(nonce)))
		return fail('invalid_request', 'nonce is malformed.')
	const prompts = new Set((params.get('prompt') ?? '').split(' ').filter(Boolean))
	if (
		[...prompts].some(
			(prompt) => !['none', 'login', 'consent', 'select_account'].includes(prompt)
		) ||
		(prompts.has('none') && prompts.size > 1)
	)
		return fail('invalid_request', 'prompt is malformed.')
	const maxAgeText = params.get('max_age')
	if (maxAgeText !== null && !/^(0|[1-9][0-9]{0,9})$/.test(maxAgeText))
		return fail('invalid_request', 'max_age must be a non-negative integer.')

	// The plugin never sees prompt/max_age: identity enforces them here, so the plugin never
	// takes its own login-redirect path (which would arm its resume cookie).
	const forward = new URL(url)
	forward.searchParams.delete('prompt')
	forward.searchParams.delete('max_age')
	const session = await input.getSession(input.request.headers)
	const now = input.now ?? Date.now()
	const stale =
		!!session &&
		maxAgeText !== null &&
		now - new Date(session.session.createdAt).getTime() > Number(maxAgeText) * 1000
	const reauthenticate = !session || prompts.has('login') || stale
	const passkey =
		!!session && (await isPasskeySession(input.pool, session.session.id, session.user.id))
	if (prompts.has('none') && (reauthenticate || !passkey))
		return fail('login_required', 'A passkey sign-in at aven.id is required.')
	if (reauthenticate)
		return redirect(
			`/login?${new URLSearchParams({ [LOGIN_RETURN_PARAM]: `${forward.pathname}${forward.search}` })}`
		)
	// A setup-link session, or an account without a passkey, finishes enrollment first.
	if (!passkey) return redirect('/dashboard')
	return new Request(forward, input.request)
}

async function token(input: OidcGateInput): Promise<Request | Response> {
	const { request } = input
	if (request.method !== 'POST')
		return oauthError(405, 'invalid_request', 'Use POST for token requests.')
	if (request.headers.get('authorization'))
		return oauthError(401, 'invalid_client', 'Registered clients are public and use PKCE.')
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
	let body: Record<string, unknown>
	try {
		if (type === 'application/x-www-form-urlencoded') {
			const form = new URLSearchParams(await request.clone().text())
			const keys = [...form.keys()]
			if (new Set(keys).size !== keys.length)
				return oauthError(400, 'invalid_request', 'Token parameters must not repeat.')
			body = Object.fromEntries(form)
		} else if (type === 'application/json') {
			const parsed = await request.clone().json()
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body')
			body = parsed as Record<string, unknown>
		} else return oauthError(400, 'invalid_request', 'Use a form-encoded token request.')
	} catch {
		return oauthError(400, 'invalid_request', 'The token request body is malformed.')
	}
	if (body.grant_type !== 'authorization_code')
		return oauthError(400, 'unsupported_grant_type', 'Only authorization_code is supported.')
	if (body.client_secret !== undefined)
		return oauthError(401, 'invalid_client', 'Registered clients are public and use PKCE.')
	if (
		typeof body.client_id !== 'string' ||
		!input.config.OIDC_CLIENTS.some((client) => client.client_id === body.client_id)
	)
		return oauthError(401, 'invalid_client', 'The client is not registered.')
	if (typeof body.code !== 'string' || !body.code || typeof body.redirect_uri !== 'string')
		return oauthError(400, 'invalid_request', 'code and redirect_uri are required.')
	if (typeof body.code_verifier !== 'string' || !pkceVerifier.test(body.code_verifier))
		return oauthError(400, 'invalid_request', 'A PKCE code_verifier is required.')
	return request
}
