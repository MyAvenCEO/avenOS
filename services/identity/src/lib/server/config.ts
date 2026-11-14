import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((value) => value === 'true')
const fingerprints = z
	.string()
	.default('')
	.transform((value) =>
		value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
	)
const provisioningSecrets = z.string().transform((value, context) => {
	const secrets = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
	if (secrets.some((secret) => secret.length < 32)) {
		context.addIssue({ code: 'custom', message: 'must contain secrets of at least 32 characters' })
		return z.NEVER
	}
	if (new Set(secrets).size !== secrets.length) {
		context.addIssue({ code: 'custom', message: 'must not contain duplicate secrets' })
		return z.NEVER
	}
	return secrets
})

// OpenID Connect relying parties are registered only here, never through dynamic registration.
// Each is a public client (no secret) that must use PKCE S256; redirect URIs match exactly.
const oidcClient = z.strictObject({
	client_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
	name: z
		.string()
		.trim()
		.min(1)
		.max(128)
		.refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters'),
	redirect_uris: z.array(z.string().max(2048)).min(1).max(16)
})
export type OidcClientConfig = z.infer<typeof oidcClient>
const oidcClients = z
	.string()
	.default('')
	.transform((value, context) => {
		if (!value.trim()) return []
		try {
			return JSON.parse(value) as unknown
		} catch {
			context.addIssue({ code: 'custom', message: 'must be a JSON array of clients' })
			return z.NEVER
		}
	})
	.pipe(z.array(oidcClient).max(32))

export function oidcRedirectUriProblem(value: string, production: boolean): string | null {
	let url: URL
	try {
		url = new URL(value)
	} catch {
		return 'must be an absolute URL'
	}
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && !production))
		return 'must use HTTPS (HTTP only for localhost outside production)'
	if (url.username || url.password) return 'must not contain credentials'
	if (url.hash || value.includes('#')) return 'must not contain a fragment'
	// Exact string matching is only unambiguous for the canonical serialization.
	if (url.href !== value) return 'must be written in canonical URL form'
	return null
}

export const identityConfigSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PUBLIC_BASE_URL: z.url().default('http://localhost:3100'),
		WEBAUTHN_RP_ID: z.string().min(1).default('localhost'),
		TRUSTED_WEB_ORIGINS: z.string().default(''),
		ANDROID_APP_CERT_SHA256_FINGERPRINTS: fingerprints,
		DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
		ACCOUNTS_DATABASE_URL: z
			.string()
			.regex(/^postgres(ql)?:\/\//)
			.optional(),
		AUTHORIZATION_DATABASE_URL: z
			.string()
			.regex(/^postgres(ql)?:\/\//)
			.optional(),
		MIGRATOR_DATABASE_URL: z
			.string()
			.regex(/^postgres(ql)?:\/\//)
			.optional(),
		BETTER_AUTH_SECRET: z.string().min(32),
		BACKUP_HEALTH_FILE: z.string().optional(),
		IDENTITY_PROVISIONING_SECRETS: provisioningSecrets,
		IDENTITY_ALLOW_NO_PLATFORMS: bool.default(false),
		IDENTITY_MAIL_ORIGINS: z
			.string()
			.default('')
			.transform((value) =>
				value
					.split(',')
					.map((v) => v.trim())
					.filter(Boolean)
			),
		REQUIRE_PASSKEY_PRF: bool.default(false),
		OIDC_CLIENTS: oidcClients,
		SESSION_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(43_200),
		SESSION_UPDATE_AGE_SECONDS: z.coerce.number().int().positive().default(3_600),
		ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
		POW_DIFFICULTY_BITS: z.coerce.number().int().min(8).max(28).default(16),
		POW_CHALLENGE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
		LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
	})
	.superRefine((config, context) => {
		if (!config.IDENTITY_PROVISIONING_SECRETS.length && !config.IDENTITY_ALLOW_NO_PLATFORMS)
			context.addIssue({
				code: 'custom',
				path: ['IDENTITY_PROVISIONING_SECRETS'],
				message: 'empty callers require explicit standalone identity mode'
			})
		if (config.IDENTITY_ALLOW_NO_PLATFORMS && config.IDENTITY_PROVISIONING_SECRETS.length)
			context.addIssue({
				code: 'custom',
				path: ['IDENTITY_ALLOW_NO_PLATFORMS'],
				message: 'standalone identity cannot have platform callers'
			})
		if (
			config.IDENTITY_MAIL_ORIGINS.length &&
			config.IDENTITY_MAIL_ORIGINS.length !== config.IDENTITY_PROVISIONING_SECRETS.length
		)
			context.addIssue({
				code: 'custom',
				path: ['IDENTITY_MAIL_ORIGINS'],
				message: 'must match provisioning-secret order and count'
			})
		for (const value of config.IDENTITY_MAIL_ORIGINS) {
			try {
				const url = new URL(value)
				if (
					url.origin !== value ||
					url.username ||
					url.password ||
					(url.protocol !== 'https:' &&
						!(config.NODE_ENV !== 'production' && url.protocol === 'http:'))
				)
					throw new Error('origin')
			} catch {
				context.addIssue({
					code: 'custom',
					path: ['IDENTITY_MAIL_ORIGINS'],
					message: 'must contain fixed HTTPS origins (HTTP only outside production)'
				})
			}
		}
		const clientIds = new Set<string>()
		config.OIDC_CLIENTS.forEach((client, index) => {
			if (clientIds.has(client.client_id) || client.client_id === 'ceo.aven.os')
				context.addIssue({
					code: 'custom',
					path: ['OIDC_CLIENTS', index, 'client_id'],
					message: 'must be unique and distinct from the native device client'
				})
			clientIds.add(client.client_id)
			if (new Set(client.redirect_uris).size !== client.redirect_uris.length)
				context.addIssue({
					code: 'custom',
					path: ['OIDC_CLIENTS', index, 'redirect_uris'],
					message: 'must not contain duplicates'
				})
			client.redirect_uris.forEach((uri, uriIndex) => {
				const problem = oidcRedirectUriProblem(uri, config.NODE_ENV === 'production')
				if (problem)
					context.addIssue({
						code: 'custom',
						path: ['OIDC_CLIENTS', index, 'redirect_uris', uriIndex],
						message: problem
					})
			})
		})
		const origin = new URL(config.PUBLIC_BASE_URL)
		if (origin.pathname !== '/' || origin.search || origin.hash)
			context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'must be an origin' })
		if (origin.hostname !== config.WEBAUTHN_RP_ID)
			context.addIssue({
				code: 'custom',
				path: ['WEBAUTHN_RP_ID'],
				message: 'must equal the public hostname'
			})
		if (config.NODE_ENV === 'production' && origin.protocol !== 'https:')
			context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'must use HTTPS' })
		if (config.NODE_ENV === 'production') {
			if (!config.IDENTITY_MAIL_ORIGINS.length && config.IDENTITY_PROVISIONING_SECRETS.length)
				context.addIssue({
					code: 'custom',
					path: ['IDENTITY_MAIL_ORIGINS'],
					message: 'security mail delivery is required in production'
				})
			for (const key of ['ACCOUNTS_DATABASE_URL', 'AUTHORIZATION_DATABASE_URL'] as const)
				if (!config[key])
					context.addIssue({
						code: 'custom',
						path: [key],
						message: 'is required in production for database-role separation'
					})
			const urls = [
				config.DATABASE_URL,
				config.ACCOUNTS_DATABASE_URL,
				config.AUTHORIZATION_DATABASE_URL
			]
				.filter(Boolean)
				.map((value) => new URL(value as string).username)
			if (new Set(urls).size !== urls.length)
				context.addIssue({
					code: 'custom',
					path: ['DATABASE_URL'],
					message: 'identity functions must use distinct database users'
				})
		}
	})

export type IdentityConfig = z.infer<typeof identityConfigSchema>

export function loadIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig {
	return identityConfigSchema.parse(env)
}

export function trustedOrigins(config: IdentityConfig): string[] {
	return [
		config.PUBLIC_BASE_URL,
		...config.TRUSTED_WEB_ORIGINS.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean)
	]
}
