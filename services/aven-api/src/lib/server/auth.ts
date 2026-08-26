import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, deviceAuthorization } from 'better-auth/plugins'
import type { ServerConfig } from './config.js'
import type { DatabaseContext } from './db.js'
import { schema } from './schema/index.js'
import { type SetupSignInVerifiers, setupSignIn } from './sign-in.js'

export const AVENOS_DEVICE_CLIENT_ID = 'ceo.aven.os'

export function requirePasskeyUserVerification(userVerified: boolean): void {
	if (!userVerified) throw new Error('Passkey authentication requires user verification.')
}

// There is deliberately NO email-initiated sign-in: accounts are created by a
// completed purchase (identity.ensureVerifiedUser, called from the grant),
// whose confirmation email carries the reusable access link (setup-token) —
// valid only until the passkey exists. After that: passkey only.
export function createAuth(
	config: ServerConfig,
	database: DatabaseContext,
	verifiers: SetupSignInVerifiers
) {
	return betterAuth({
		appName: 'Aven',
		baseURL: config.PUBLIC_BASE_URL,
		basePath: '/api/auth',
		secret: config.BETTER_AUTH_SECRET,
		trustedOrigins: [config.PUBLIC_BASE_URL],
		database: drizzleAdapter(database.db, { provider: 'pg', schema }),
		user: {
			additionalFields: {
				role: {
					type: 'string',
					fieldName: 'role',
					required: true,
					defaultValue: 'user',
					input: false
				}
			}
		},
		session: {
			expiresIn: config.BETTER_AUTH_SESSION_MAX_AGE_SECONDS,
			updateAge: config.BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS
		},
		advanced: { useSecureCookies: config.NODE_ENV === 'production' },
		rateLimit: {
			enabled: true,
			window: 60,
			max: 60,
			customRules: {
				'/device/code': { window: 60, max: 10 },
				'/device/token': { window: 60, max: 30 },
				'/device/approve': { window: 60, max: 10 },
				'/passkey/generate-authenticate-options': { window: 60, max: 20 },
				'/passkey/verify-authentication': { window: 60, max: 10 },
				'/passkey/generate-register-options': { window: 3600, max: 10 },
				'/passkey/verify-registration': { window: 3600, max: 10 }
			}
		},
		plugins: [
			bearer(),
			deviceAuthorization({
				expiresIn: '10m',
				interval: '3s',
				verificationUri: '/device',
				validateClient: (clientId) => clientId === AVENOS_DEVICE_CLIENT_ID
			}),
			passkey({
				rpID: config.WEBAUTHN_RP_ID,
				rpName: 'Aven',
				origin: config.PUBLIC_BASE_URL,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				authentication: {
					afterVerification: ({ verification }) =>
						requirePasskeyUserVerification(verification.authenticationInfo.userVerified)
				}
			}),
			setupSignIn(verifiers)
		]
	})
}
export type AvenAuth = ReturnType<typeof createAuth>
