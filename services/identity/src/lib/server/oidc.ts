import type { OAuthProviderExtension, SchemaClient, Scope } from '@better-auth/oauth-provider'
import { json } from '@sveltejs/kit'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { type JwtOptions, signJWT } from 'better-auth/plugins'
import { LOGIN_RETURN_PARAM } from '../return-path.js'
import type { IdentityConfig } from './config.js'
import type { Queryable } from './db.js'

// OpenID Connect authorization-code + PKCE for relying parties registered in OIDC_CLIENTS.
// Better Auth's oauth-provider plugin issues codes and tokens; this module is the policy in
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
/** Provenance of clients served from OIDC_CLIENTS (never stored in the database). */
export const OIDC_CLIENT_DISCOVERY_ID = 'identity-config'
/**
 * The plugin resumes a pending authorization from a signed `oauth_query` body field: any
 * endpoint that receives one and then sets a session cookie (a passkey sign-in, and in
 * principle any other sign-in) mints a code from it. Identity never lets the plugin sign
 * such a query (the gate below handles sign-in, consent and account selection itself), and
 * Better Auth's first `before` hook refuses every request that carries one, so only the
 * gate can lead to a code.
 */
export const PLUGIN_RESUME_FIELD = 'oauth_query'

// Everything else the plugin serves (client and consent CRUD, registration, introspection,
// revocation, end-session, continue/consent, its admin resource API and its own discovery
// documents) is closed: clients are configuration, /.well-known/openid-configuration is the
// discovery document, and RPs only need authorize, token, userinfo and the JWKS.
const openPluginPaths = new Set<string>([
	OIDC_PATHS.authorize,
	OIDC_PATHS.token,
	OIDC_PATHS.userinfo
])
const closedPluginPrefixes = [
	'/api/auth/oauth2/',
	'/api/auth/admin/oauth2/',
	'/api/auth/.well-known/'
]
// The only authorization parameters the plugin receives; everything else (prompt, max_age,
// claims, resource, request_uri, dpop_jkt, hints, ...) is enforced or dropped here.
const forwardedAuthorizeParams = new Set([
	'response_type',
	'client_id',
	'redirect_uri',
	'scope',
	'state',
	'nonce',
	'code_challenge',
	'code_challenge_method'
])
const pkceChallenge = /^[A-Za-z0-9_-]{43}$/
const pkceVerifier = /^[A-Za-z0-9._~-]{43,128}$/
const printable = /^[\x20-\x7e]*$/

/** OIDC_CLIENTS as oauth-provider client records: public, PKCE, exact redirects, no consent. */
export function configuredOidcClients(config: IdentityConfig): SchemaClient<Scope[]>[] {
	return config.OIDC_CLIENTS.map((client) => ({
		clientId: client.client_id,
		clientDiscoveryId: OIDC_CLIENT_DISCOVERY_ID,
		name: client.name,
		disabled: false,
		redirectUris: [...client.redirect_uris],
		tokenEndpointAuthMethod: 'none' as const,
		grantTypes: ['authorization_code'],
		responseTypes: ['code' as const],
		scopes: [...OIDC_SCOPES],
		applicationType: 'web' as const,
		subjectType: 'public' as const,
		requirePKCE: true,
		skipConsent: true,
		enableEndSession: false
	}))
}

/**
 * Serves relying parties from OIDC_CLIENTS through the plugin's client-discovery extension, so
 * the oauth_client table stays empty and read-only for the runtime role.
 */
export function oidcClientDiscovery(config: IdentityConfig): OAuthProviderExtension {
	const clients = new Map(configuredOidcClients(config).map((client) => [client.clientId, client]))
	return {
		clientDiscovery: {
			id: OIDC_CLIENT_DISCOVERY_ID,
			matches: (clientId) => clients.has(clientId),
			resolve: (_ctx, clientId) => {
				const client = clients.get(clientId)
				return client ? structuredClone(client) : null
			}
		}
	}
}

/** Plain http: redirect URIs reach the plugin only as loopback URIs registered outside production. */
export function isRegisteredInsecureRedirect(config: IdentityConfig, url: URL): boolean {
	return (
		config.NODE_ENV !== 'production' &&
		config.OIDC_CLIENTS.some((client) => client.redirect_uris.includes(url.href))
	)
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

/** True when a parsed Better Auth request body carries the plugin's signed resume query. */
export function carriesPluginResume(body: unknown): boolean {
	return typeof body === 'object' && body !== null && PLUGIN_RESUME_FIELD in body
}

/** Whether the gate answers 404 for this path before Better Auth sees it. */
export function isClosedPluginPath(pathname: string): boolean {
	const path = pathname.replace(/\/$/, '')
	return (
		!openPluginPaths.has(path) &&
		closedPluginPrefixes.some((prefix) => `${path}/`.startsWith(prefix))
	)
}

type ClaimUser = { name?: string | null; image?: string | null; updatedAt?: Date | string }

function updatedAt(user: ClaimUser): number | undefined {
	const time = user.updatedAt ? new Date(user.updatedAt).getTime() : Number.NaN
	return Number.isFinite(time) ? Math.floor(time / 1000) : undefined
}

/**
 * ID-token profile and email claims. The plugin puts only protocol claims into the ID token;
 * these mirror its UserInfo claims (same name split) plus `updated_at` in seconds.
 */
export function idTokenClaims(
	user: ClaimUser & { email?: string | null; emailVerified?: boolean | null },
	scopes: readonly string[]
): Record<string, unknown> {
	const claims: Record<string, unknown> = {}
	if (scopes.includes('email')) {
		claims.email = user.email ?? undefined
		claims.email_verified = user.emailVerified ?? false
	}
	if (scopes.includes('profile')) {
		const parts = (user.name ?? '').split(' ').filter(Boolean)
		claims.name = user.name ?? undefined
		claims.picture = user.image ?? undefined
		if (parts.length > 1) {
			claims.given_name = parts.slice(0, -1).join(' ')
			claims.family_name = parts.at(-1)
		}
		claims.updated_at = updatedAt(user)
	}
	return claims
}

/** UserInfo additions: the plugin resolves name/picture/email itself; OIDC also defines updated_at. */
export function userInfoClaims(
	user: ClaimUser,
	scopes: readonly string[]
): Record<string, unknown> {
	return scopes.includes('profile') ? { updated_at: updatedAt(user) } : {}
}

/**
 * States how the user authenticated. The plugin owns `amr` and `acr` and strips them from custom
 * claims, so this re-signs the ID token it just issued with the same jwt-plugin key, adding
 * `amr: ["passkey"]` (the gate issues codes only for passkey sessions) and dropping the
 * plugin's placeholder `acr: "0"`. Every other claim, including at_hash, is kept as issued.
 */
export function oidcAuthenticationMethod(): BetterAuthPlugin {
	return {
		id: 'identity-oidc-amr',
		hooks: {
			after: [
				{
					matcher: (ctx) => ctx.path === '/oauth2/token',
					handler: createAuthMiddleware(async (ctx) => {
						const returned = ctx.context.returned
						if (!returned || typeof returned !== 'object' || returned instanceof Response) return
						const idToken = (returned as { id_token?: unknown }).id_token
						if (typeof idToken !== 'string') return
						const jwtOptions = ctx.context.getPlugin('jwt')?.options as JwtOptions | undefined
						if (!jwtOptions) throw new APIError('INTERNAL_SERVER_ERROR')
						const { acr: _acr, ...payload } = JSON.parse(
							Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString()
						) as Record<string, unknown>
						const signed = await signJWT(ctx, {
							options: jwtOptions,
							payload: { ...payload, amr: ['passkey'] }
						})
						return ctx.json({ ...(returned as Record<string, unknown>), id_token: signed })
					})
				}
			]
		}
	}
}

/** Removes one bounded batch of expired OIDC access-token rows. */
export async function cleanupOidcTokens(pool: Queryable): Promise<number> {
	const result = await pool.query(
		`DELETE FROM oauth_access_token WHERE id IN (SELECT id FROM oauth_access_token
		 WHERE expires_at < now() LIMIT 1000)`
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
	if (isClosedPluginPath(url.pathname)) return json({ code: 'NOT_FOUND' }, { status: 404 })
	const path = url.pathname.replace(/\/$/, '')
	if (path === OIDC_PATHS.authorize) return authorize(input, url)
	if (path === OIDC_PATHS.token) return token(input)
	return input.request
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

	// The plugin sees only the parameters above: identity enforces prompt and max_age here, so
	// the plugin never takes its own login, consent or account-selection redirect (which would
	// sign a resumable oauth_query), and nothing else it understands reaches it.
	const forward = new URL(url.pathname, url)
	for (const [key, value] of params)
		if (forwardedAuthorizeParams.has(key)) forward.searchParams.append(key, value)
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
	if (request.headers.has('dpop'))
		return oauthError(400, 'invalid_request', 'DPoP is not supported.')
	const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
	if (type !== 'application/x-www-form-urlencoded')
		return oauthError(400, 'invalid_request', 'Use a form-encoded token request.')
	let body: Record<string, string>
	try {
		const form = new URLSearchParams(await request.clone().text())
		const keys = [...form.keys()]
		if (new Set(keys).size !== keys.length)
			return oauthError(400, 'invalid_request', 'Token parameters must not repeat.')
		body = Object.fromEntries(form)
	} catch {
		return oauthError(400, 'invalid_request', 'The token request body is malformed.')
	}
	if (body.grant_type !== 'authorization_code')
		return oauthError(400, 'unsupported_grant_type', 'Only authorization_code is supported.')
	if (
		body.client_secret !== undefined ||
		body.client_assertion !== undefined ||
		body.client_assertion_type !== undefined
	)
		return oauthError(401, 'invalid_client', 'Registered clients are public and use PKCE.')
	if (body.resource !== undefined)
		return oauthError(400, 'invalid_target', 'Resource indicators are not supported.')
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
