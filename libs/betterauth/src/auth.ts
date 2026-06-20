import { passkey } from '@better-auth/passkey'
import { polar } from '@polar-sh/better-auth'
import { Polar } from '@polar-sh/sdk'
import { betterAuth } from 'better-auth'
import { admin, bearer } from 'better-auth/plugins'
import { NeonDialect } from 'kysely-neon'
import { db } from './db'

/**
 * Origins allowed to call the auth API with credentials. The mainnet app runs on a
 * different origin than this server, so every dev/app origin must be trusted here AND
 * allowed by CORS in `server.ts`. Extend when the desktop `.app` origin is finalized.
 */
export const TRUSTED_ORIGINS = [
	'http://localhost:5173', // sveltekit/vite default
	'http://localhost:5182', // this worktree's preview (see .claude/launch.json)
	'http://localhost:1420', // tauri dev (localhost form)
	'http://127.0.0.1:1420', // tauri dev (devUrl is 127.0.0.1:1420 — a distinct origin)
	'http://tauri.localhost', // tauri prod webview (windows/linux)
	'tauri://localhost' // tauri prod webview (macos)
]

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`[betterauth] missing env ${name}`)
	return value
}

function optionalEnv(name: string): string | undefined {
	const value = process.env[name]
	return value && value.length > 0 ? value : undefined
}

/**
 * Polar account link. Wired ONLY when POLAR_API_KEY is present, so the server still
 * boots without billing configured. Account connection only: `createCustomerOnSignUp`
 * creates a Polar customer per Better Auth user — products/checkout/portal come later
 * (`use: []`). POLAR_SERVER selects sandbox vs production and MUST match the env the
 * POLAR_API_KEY was issued in (default: sandbox).
 */
const polarToken = optionalEnv('POLAR_API_KEY') ?? optionalEnv('POLAR_ACCESS_TOKEN')
if (!polarToken) {
	console.warn('[betterauth] POLAR_API_KEY not set — Polar account link disabled')
}
// Shared Polar client, reused by the plugin, the checkout/webhook billing routes
// (src/billing.ts), and our own best-effort customer link below. null when Polar isn't
// configured.
export const polarClient = polarToken
	? new Polar({
			accessToken: polarToken,
			// Default to production (polar.sh) — tokens minted there 401 against sandbox.
			// Set POLAR_SERVER=sandbox explicitly for sandbox.polar.sh tokens.
			server: (optionalEnv('POLAR_SERVER') as 'sandbox' | 'production') ?? 'production'
		})
	: null
const polarPlugins = polarClient
	? [
			polar({
				client: polarClient,
				// We link the customer ourselves (see linkPolarCustomer) so a Polar hiccup or a
				// stale customer (e.g. after a DB reset) can NEVER block signup. The plugin's own
				// create-on-signup throws on an external_id conflict, so we keep it off. board 0052.
				createCustomerOnSignUp: false,
				// Account link only — products/checkout/portal come later. The plugin's types
				// (1.8.4) require a non-empty `use`, but the runtime accepts [] (per the docs).
				// @ts-expect-error empty `use` is valid at runtime for account-connection-only
				use: []
			})
		]
	: []

/**
 * Best-effort: link a Polar customer to this user, returning whether the link is confirmed.
 * NEVER throws — a failure just means `polarLinked` stays false for later reconciliation.
 * Creates the customer WITH `external_id` in one call (the plugin instead created it then
 * tried to UPDATE external_id, which Polar forbids — the bug that blocked signup). If a
 * customer already exists for the email, it's "linked" only if its external_id already
 * matches this user (external_id is immutable). board 0052.
 */
export async function linkPolarCustomer(user: {
	id: string
	email: string
	name?: string
}): Promise<boolean> {
	if (!polarClient || !user.email) return false
	try {
		const { result } = await polarClient.customers.list({ email: user.email })
		const existing = result.items[0]
		if (existing) return existing.externalId === user.id
		await polarClient.customers.create({ email: user.email, name: user.name, externalId: user.id })
		return true
	} catch (e) {
		console.error(
			'[betterauth] Polar customer link failed (non-fatal):',
			e instanceof Error ? e.message : e
		)
		return false
	}
}

/**
 * Self-hosted Better Auth instance. Database is Neon Postgres via the community
 * kysely-neon dialect (WebSocket driver — supports the transactions the CLI migrate
 * and OAuth flows need). Google is the only social provider for now (board 0050).
 *
 * Cross-origin note: the app fetches this server from another origin, so session
 * cookies must be SameSite=None; Secure to be sent on cross-site requests. Browsers
 * accept Secure cookies over http://localhost, so this works in dev too.
 */
// Public iOS OAuth client id (avenCEO-ios). Native iOS Google Sign-In must use an iOS-type
// client (no secret), so its idTokens carry a different `aud` than the desktop client. List
// BOTH as valid audiences so macOS (desktop client) and iOS both verify. board 0050.
const GOOGLE_IOS_CLIENT_ID =
	'623539759782-dh478o33v7hu3d658albbsrsq31s2ng7.apps.googleusercontent.com'

export const auth = betterAuth({
	baseURL: requireEnv('BETTER_AUTH_URL'),
	secret: requireEnv('BETTER_AUTH_SECRET'),
	database: {
		dialect: new NeonDialect({ connectionString: requireEnv('NEON_PG_KEY') }),
		type: 'postgres'
	},
	socialProviders: {
		google: {
			// Array = multiple accepted idToken audiences (desktop client for macOS, iOS client
			// for iOS). The secret belongs to the desktop client; iOS verifies by audience only.
			clientId: [requireEnv('GOOGLE_CLIENT_ID'), GOOGLE_IOS_CLIENT_ID],
			clientSecret: requireEnv('GOOGLE_CLIENT_SECRET')
		}
	},
	// Product tier on the user (free | avenCITY). Assigned by an admin; gates the weekly
	// AI credit allowance. `input: false` so it can't be set by the client at sign-up. board 0052.
	user: {
		additionalFields: {
			tier: { type: 'string', required: false, defaultValue: 'free', input: false },
			// True once we've confirmed a linked Polar customer for this user. Defaults false;
			// users left at false are the ones to reconcile later (Polar was down, conflict,
			// or not configured). `input: false` — server-managed only. board 0052.
			polarLinked: { type: 'boolean', required: false, defaultValue: false, input: false }
		}
	},
	databaseHooks: {
		user: {
			create: {
				// Bootstrap the very first user to sign up as admin — and ONLY the first. Every
				// later signup keeps the default role. Replaces the manual "first admin in Neon".
				before: async (user) => {
					try {
						const row = await db()
							.selectFrom('user')
							.select(({ fn }) => fn.countAll<string>().as('n'))
							.executeTakeFirst()
						if (!row || Number(row.n) === 0) {
							return { data: { ...user, role: 'admin' } }
						}
					} catch (e) {
						console.error('[betterauth] first-admin bootstrap check failed:', e)
					}
					return { data: user }
				},
				// Best-effort Polar customer link; flip `polarLinked` true only on confirmed
				// success. Never throws — signup must not depend on the billing provider.
				after: async (user) => {
					const u = user as { id: string; email: string; name?: string }
					const linked = await linkPolarCustomer(u)
					if (linked) {
						await db()
							.updateTable('user')
							.set({ polarLinked: true })
							.where('id', '=', u.id)
							.execute()
							.catch((e) => console.error('[betterauth] set polarLinked failed:', e))
					}
				}
			}
		}
	},
	trustedOrigins: TRUSTED_ORIGINS,
	// `bearer` lets the Tauri app authenticate with an Authorization: Bearer token
	// instead of a cookie — WKWebView drops the cross-site session cookie, so the
	// desktop native sign-in path stores + sends the token returned by the server.
	// `admin` adds a `role` field (user|admin) + admin-gated user management
	// (list/setRole/ban/impersonate). The first user to sign up is auto-promoted to admin
	// via the databaseHooks below; every later signup is a normal user. board 0052.
	// `passkey` (board 0055): a passkey linked next to Google = the avenFOUNDER→avenCEO 2nd
	// factor, AND the source of the vault-unlock PRF. rp.id = the AASA host; origin = the app's
	// WebAuthn ceremony origins (tauri://localhost etc.). Runs inside the native Tauri webview.
	plugins: [
		bearer(),
		admin(),
		passkey({
			rpID: optionalEnv('PASSKEY_RP_ID') ?? 'api.next.aven.ceo',
			rpName: 'avenOS',
			origin: TRUSTED_ORIGINS
		}),
		...polarPlugins
	],
	advanced: {
		defaultCookieAttributes: {
			sameSite: 'none',
			secure: true
		}
	}
})
