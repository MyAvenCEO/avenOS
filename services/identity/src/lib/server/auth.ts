import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, deviceAuthorization, jwt } from 'better-auth/plugins'
import type { IdentityConfig } from './config.js'
import { trustedOrigins } from './config.js'
import type { DatabaseContext } from './db.js'
import { schema } from './schema.js'
import { setupSignIn } from './setup-sign-in.js'

export const AVENOS_DEVICE_CLIENT_ID = 'ceo.aven.os'
export const accessTokenExpiration = (seconds: number) => `${seconds}s`

export function androidPasskeyOrigins(fingerprints: string[]): string[] {
	return fingerprints.map((fingerprint) => {
		const hash = Buffer.from(fingerprint.replaceAll(':', ''), 'hex').toString('base64url')
		return `android:apk-key-hash:${hash}`
	})
}

export function createAuth(
	config: IdentityConfig,
	database: DatabaseContext,
	verifySetup: (token: string) => Promise<{ userId: string } | null>
) {
	const origins = [
		...trustedOrigins(config),
		...androidPasskeyOrigins(config.ANDROID_APP_CERT_SHA256_FINGERPRINTS)
	]
	return betterAuth({
		appName: 'Aven Identity',
		baseURL: config.PUBLIC_BASE_URL,
		basePath: '/api/auth',
		secret: config.BETTER_AUTH_SECRET,
		trustedOrigins: origins,
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
			expiresIn: config.SESSION_MAX_AGE_SECONDS,
			updateAge: config.SESSION_UPDATE_AGE_SECONDS
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
				'/passkey/verify-registration': { window: 3600, max: 10 },
				'/token': { window: 60, max: 60 }
			}
		},
		plugins: [
			bearer(),
			deviceAuthorization({
				expiresIn: '10m',
				interval: '3s',
				verificationUri: '/device',
				validateClient: (id) => id === AVENOS_DEVICE_CLIENT_ID
			}),
			passkey({
				rpID: config.WEBAUTHN_RP_ID,
				rpName: 'Aven',
				origin: origins,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				authentication: {
					afterVerification: ({ verification }) => {
						if (!verification.authenticationInfo.userVerified)
							throw new Error('Passkey authentication requires user verification.')
					}
				}
			}),
			jwt({
				jwks: {
					jwksPath: '/jwks',
					keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
					rotationInterval: 60 * 60 * 24 * 30,
					gracePeriod: 60 * 60 * 24 * 7
				},
				jwt: {
					issuer: config.PUBLIC_BASE_URL,
					audience: 'aven-services',
					expirationTime: accessTokenExpiration(config.ACCESS_TOKEN_TTL_SECONDS),
					definePayload: async ({ user, session }) => {
						const hasPasskey = Boolean(
							(
								await database.pool.query('SELECT 1 FROM passkey WHERE user_id=$1 LIMIT 1', [
									user.id
								])
							).rows[0]
						)
						return {
							sub: user.id,
							sid: session.id,
							email: user.email,
							email_verified: user.emailVerified,
							role: user.role === 'admin' ? 'admin' : 'user',
							amr: hasPasskey ? ['passkey'] : ['bootstrap'],
							scope: hasPasskey
								? 'openid profile email services:access'
								: 'openid profile email account:bootstrap'
						}
					}
				}
			}),
			setupSignIn(verifySetup)
		]
	})
}

export type IdentityAuth = ReturnType<typeof createAuth>
