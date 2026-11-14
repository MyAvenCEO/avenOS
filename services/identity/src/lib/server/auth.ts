import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { bearer, deviceAuthorization, jwt } from 'better-auth/plugins'
import { oidcProvider } from 'better-auth/plugins/oidc-provider'
import type { IdentityConfig } from './config.js'
import { trustedOrigins } from './config.js'
import type { DatabaseContext } from './db.js'
import { enrollmentAdapter, enrollmentContext, registrationPrfEnabled } from './enrollment.js'
import { isPasskeySession, OIDC_CODE_SECONDS, OIDC_SCOPES, trustedOidcClients } from './oidc.js'
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
	verifySetup: (token: string) => Promise<{ userId: string; tokenHash: string } | null>
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
		database: enrollmentAdapter(database),
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
			updateAge: config.SESSION_UPDATE_AGE_SECONDS,
			additionalFields: {
				setupTokenHash: { type: 'string', required: false, input: false, returned: false }
			}
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
				'/token': { window: 60, max: 60 },
				'/oauth2/authorize': { window: 60, max: 30 },
				'/oauth2/token': { window: 60, max: 20 },
				'/oauth2/userinfo': { window: 60, max: 60 }
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
				rpName: 'aven.id',
				origin: origins,
				authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
				registration: {
					afterVerification: ({ ctx, verification, clientData, user }) => {
						const context = enrollmentContext.getStore()
						const session = ctx.context.session
						const prfEnabled = registrationPrfEnabled(clientData.clientExtensionResults)
						if (
							!context ||
							!session ||
							!verification.registrationInfo?.userVerified ||
							(config.REQUIRE_PASSKEY_PRF && !prfEnabled)
						)
							throw new Error(
								'Passkey registration requires a verified user and supported authenticator.'
							)
						context.registration = { sessionId: session.session.id, userId: user.id, prfEnabled }
					}
				},
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
						const hasPasskey = await isPasskeySession(database.pool, session.id, user.id)
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
			// ID tokens reuse the jwt plugin's EdDSA keys; the plugin overrides iss/aud/sub/exp
			// and the payload for them, so service-JWT claims never leak into an ID token.
			// Identity policy (passkey-only, S256, scopes, closed registration) is oidcGate.
			oidcProvider({
				loginPage: '/login',
				useJWTPlugin: true,
				requirePKCE: true,
				allowPlainCodeChallengeMethod: false,
				allowDynamicClientRegistration: false,
				trustedClients: trustedOidcClients(config),
				scopes: [...OIDC_SCOPES],
				codeExpiresIn: OIDC_CODE_SECONDS,
				accessTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
				// The plugin always stores a refresh token; it is never returned (offline_access
				// is refused) and the refresh grant is closed, so keep its row lifetime minimal.
				refreshTokenExpiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
				// Only passkey sessions reach a code, so the ID token states it. auth_time is
				// dropped because the plugin has no session at the token endpoint; acr is unused.
				// The plugin's profile claims put the avatar in `profile` and an ISO updated_at;
				// OIDC defines `picture` and seconds.
				getAdditionalUserInfoClaim: (user, scopes) => ({
					amr: ['passkey'],
					auth_time: undefined,
					acr: undefined,
					...(scopes.includes('profile')
						? {
								profile: undefined,
								picture: user.image ?? undefined,
								updated_at: Math.floor(new Date(user.updatedAt).getTime() / 1000)
							}
						: {})
				})
			}),
			setupSignIn(verifySetup)
		]
	})
}

export type IdentityAuth = ReturnType<typeof createAuth>
