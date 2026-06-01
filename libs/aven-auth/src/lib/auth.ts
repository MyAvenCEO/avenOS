import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'
import Database from 'better-sqlite3'
import { avenAuth } from '$lib/auth/plugins/aven-auth'
import { avenAuthEnv } from '$lib/env'

const env = avenAuthEnv()

export const auth = betterAuth({
	database: new Database(env.dbPath),
	baseURL: env.authUrl,
	secret: env.secret,
	emailAndPassword: { enabled: false },
	trustedOrigins: [
		env.authUrl,
		'http://localhost:3000',
		'http://localhost:1420',
		'http://127.0.0.1:1420',
		'https://auth.testnet.aven.ceo',
		'tauri://localhost'
	],
	plugins: [
		// The Tauri app authenticates with a Bearer token (the session token returned by
		// verify) — cross-site cookies don't survive the webview → :3000 hop.
		bearer(),
		avenAuth({
			domain: env.domain,
			networkSeed: env.networkSeed,
			authUrl: env.authUrl,
			defaultInviteExpiresInSeconds: env.defaultInviteExpiresInSeconds,
			inviteDeepLinkScheme: env.inviteDeepLinkScheme
		})
	]
})

export type Auth = typeof auth
