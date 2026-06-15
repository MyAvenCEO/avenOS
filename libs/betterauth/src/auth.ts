import { betterAuth } from 'better-auth'
import { NeonDialect } from 'kysely-neon'

/**
 * Origins allowed to call the auth API with credentials. The mainnet app runs on a
 * different origin than this server, so every dev/app origin must be trusted here AND
 * allowed by CORS in `server.ts`. Extend when the desktop `.app` origin is finalized.
 */
export const TRUSTED_ORIGINS = [
	'http://localhost:5173', // sveltekit/vite default
	'http://localhost:5182', // this worktree's preview (see .claude/launch.json)
	'http://localhost:1420', // tauri dev
	'http://tauri.localhost',
	'tauri://localhost'
]

function requireEnv(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`[betterauth] missing env ${name}`)
	return value
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
export const auth = betterAuth({
	baseURL: requireEnv('BETTER_AUTH_URL'),
	secret: requireEnv('BETTER_AUTH_SECRET'),
	database: {
		dialect: new NeonDialect({ connectionString: requireEnv('NEON_PG_KEY') }),
		type: 'postgres'
	},
	socialProviders: {
		google: {
			clientId: requireEnv('GOOGLE_CLIENT_ID'),
			clientSecret: requireEnv('GOOGLE_CLIENT_SECRET')
		}
	},
	trustedOrigins: TRUSTED_ORIGINS,
	advanced: {
		defaultCookieAttributes: {
			sameSite: 'none',
			secure: true
		}
	}
})
