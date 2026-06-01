import Database from 'better-sqlite3'
import { betterAuth } from 'better-auth'

import { avenSelfEnv } from '$lib/env'
import { avenSelf } from '$lib/auth/plugins/aven-self'

const env = avenSelfEnv()

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
		'https://self.testnet.aven.ceo',
		'tauri://localhost',
	],
	plugins: [
		avenSelf({
			domain: env.domain,
			networkSeed: env.networkSeed,
			authUrl: env.authUrl,
			defaultInviteExpiresInSeconds: env.defaultInviteExpiresInSeconds,
			inviteDeepLinkScheme: env.inviteDeepLinkScheme,
		}),
	],
})

export type Auth = typeof auth
