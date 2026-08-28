import { plan } from '@myavenceo/aven-ceo/pricing'
import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((value) => value === 'true')
const positiveInt = z.coerce.number().int().positive()
const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres URL')
const androidCertificateFingerprints = z
	.string()
	.default('')
	.refine(
		(value) =>
			value
				.split(',')
				.map((fingerprint) => fingerprint.trim())
				.filter(Boolean)
				.every((fingerprint) => /^(?:[0-9a-fA-F]{2}:){31}[0-9a-fA-F]{2}$/.test(fingerprint)),
		'must be comma-separated SHA-256 certificate fingerprints'
	)
	.transform((value) =>
		value
			.split(',')
			.map((fingerprint) => fingerprint.trim().toUpperCase())
			.filter(Boolean)
	)
const validEncryptionKey = (value: string) => {
	try {
		return Buffer.from(value, 'base64').length === 32
	} catch {
		return false
	}
}

export const serverConfigSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PUBLIC_BASE_URL: z.url(),
		WEBAUTHN_RP_ID: z.string().min(1),
		ANDROID_APP_CERT_SHA256_FINGERPRINTS: androidCertificateFingerprints,
		REQUIRE_PASSKEY_PRF: bool.default(false),
		DOWNLOAD_URL: z.string().default(''),
		LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
		APPLICATION_VERSION: z.string().min(1).default('0.1.0'),

		DATABASE_URL: postgresUrl,
		MIGRATOR_DATABASE_URL: postgresUrl.optional(),
		EMAIL_WORKER_DATABASE_URL: postgresUrl.optional(),
		ENVIRONMENT_WORKER_DATABASE_URL: postgresUrl.optional(),
		PROVISIONER_DATABASE_URL: postgresUrl.optional(),

		ARTIFACT_STORE_BASE_URL: z.url().optional(),
		ARTIFACT_STORE_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_STORE_PROVISIONER_BASE_URL: z.url().optional(),
		ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_STORE_RUNTIME_ROLE: z
			.string()
			.regex(/^[a-z][a-z0-9_]{0,62}$/)
			.optional(),
		ARTIFACT_STORE_RUNTIME_PASSWORD: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_PROCESSOR_BASE_URL: z.url().optional(),
		ARTIFACT_PROCESSOR_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_PROCESSOR_DIRECTORY_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL: z.url().optional(),
		ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		ARTIFACT_PROCESSOR_RUNTIME_ROLE: z
			.string()
			.regex(/^[a-z][a-z0-9_]{0,62}$/)
			.optional(),
		ARTIFACT_PROCESSOR_RUNTIME_PASSWORD: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be a URL-safe secret')
			.optional(),
		LLM_GATEWAY_ENABLED: bool.default(false),
		LLM_GATEWAY_MODELS_JSON: z.string().max(131_072).default('[]'),
		LLM_GATEWAY_CREDENTIALS_JSON: z.string().max(65_536).default('{}'),
		LLM_GATEWAY_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(900).default(180),
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: bool.default(false),
		INTENT_SERVICE_BASE_URL: z.url().optional(),
		INTENT_SERVICE_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		INTENT_SERVICE_DIRECTORY_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		INTENT_SERVICE_PROVISIONER_BASE_URL: z.url().optional(),
		INTENT_SERVICE_PROVISIONER_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		INTENT_SERVICE_RUNTIME_ROLE: z
			.string()
			.regex(/^[a-z][a-z0-9_]{0,62}$/)
			.optional(),
		INTENT_SERVICE_RUNTIME_PASSWORD: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		SITE_HOST_DIRECTORY_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		SITE_HOST_PUBLIC_IPV4: z.union([z.ipv4(), z.literal('')]).default(''),
		SITE_HOST_PUBLIC_IPV6: z.string().default(''),

		BETTER_AUTH_SECRET: z.string().default(''),
		BETTER_AUTH_SESSION_MAX_AGE_SECONDS: positiveInt.default(43_200),
		BETTER_AUTH_SESSION_UPDATE_AGE_SECONDS: positiveInt.default(3_600),
		POW_DIFFICULTY_BITS: z.coerce.number().int().min(8).max(28).default(16),
		POW_CHALLENGE_TTL_SECONDS: positiveInt.default(300),

		EMAIL_QUEUE_ENCRYPTION_KEY: z.string().default(''),
		EMAIL_MAX_ATTEMPTS: positiveInt.default(10),
		EMAIL_WORKER_STALE_SECONDS: positiveInt.default(45),
		SMTP_URL: z.string().default(''),
		SMTP_FROM: z.string().default(''),
		SMTP_REPLY_TO: z.string().optional().or(z.literal('')),
		EMAIL_WORKER_POLL_INTERVAL_MS: positiveInt.default(1_000),
		EMAIL_WORKER_BATCH_SIZE: positiveInt.default(10),
		EMAIL_WORKER_LEASE_SECONDS: positiveInt.default(120),
		EMAIL_WORKER_HEARTBEAT_SECONDS: positiveInt.default(10),
		EMAIL_RETRY_BASE_SECONDS: positiveInt.default(30),
		EMAIL_RETRY_MAX_SECONDS: positiveInt.default(21_600),

		ENVIRONMENT_WORKER_POLL_INTERVAL_MS: positiveInt.default(1_000),
		ENVIRONMENT_WORKER_LEASE_SECONDS: positiveInt.default(300),
		ENVIRONMENT_WORKER_HEARTBEAT_SECONDS: positiveInt.default(10),
		ENVIRONMENT_WORKER_STALE_SECONDS: positiveInt.default(45),
		ENVIRONMENT_RECONCILE_INTERVAL_SECONDS: positiveInt.default(30),
		ENVIRONMENT_MAX_ATTEMPTS: positiveInt.default(10),
		ENVIRONMENT_RETRY_BASE_SECONDS: positiveInt.default(30),
		ENVIRONMENT_RETRY_MAX_SECONDS: positiveInt.default(21_600),

		ALLOW_FAKE_PAYMENTS: bool.default(false),
		NAME_PRICE_EUR: z.coerce.number().positive().default(25),
		NAME_HOLD_TTL_HOURS: positiveInt.default(24),
		NAME_RESERVATION_TTL_MINUTES: positiveInt.default(5),
		POLAR_API_KEY: z.string().default(''),
		// Which Polar environment the SDK talks to — sandbox and production
		// are fully separate orgs/tokens; flipping this IS the env switch.
		POLAR_SERVER: z.enum(['sandbox', 'production']).default('sandbox'),
		// Sanity anchor only: the org token already scopes every call, and
		// create calls never pass an organization id.
		POLAR_ORGANIZATION_ID: z.string().default(''),
		POLAR_WEBHOOK_SECRET: z.string().min(8).default('dev-fake-webhook-secret')
	})
	.superRefine((config, context) => {
		const artifactValues = [config.ARTIFACT_STORE_BASE_URL, config.ARTIFACT_STORE_BEARER_TOKEN]
		if (artifactValues.some(Boolean) && !artifactValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['ARTIFACT_STORE_BASE_URL'],
				message: 'base URL and bearer token must be configured together'
			})
		}
		const processorValues = [
			config.ARTIFACT_PROCESSOR_BASE_URL,
			config.ARTIFACT_PROCESSOR_BEARER_TOKEN
		]
		if (processorValues.some(Boolean) && !processorValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['ARTIFACT_PROCESSOR_BASE_URL'],
				message: 'processor URL and bearer token must be configured together'
			})
		}
		const processorProvisioningValues = [
			config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL,
			config.ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN,
			config.ARTIFACT_PROCESSOR_RUNTIME_ROLE,
			config.ARTIFACT_PROCESSOR_RUNTIME_PASSWORD
		]
		if (processorProvisioningValues.some(Boolean) && !processorProvisioningValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL'],
				message:
					'processor provisioner URL/token and runtime role/password must be configured together'
			})
		}
		const intentValues = [config.INTENT_SERVICE_BASE_URL, config.INTENT_SERVICE_BEARER_TOKEN]
		if (intentValues.some(Boolean) && !intentValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['INTENT_SERVICE_BASE_URL'],
				message: 'intent service URL and bearer token must be configured together'
			})
		}
		const intentProvisioningValues = [
			config.INTENT_SERVICE_PROVISIONER_BASE_URL,
			config.INTENT_SERVICE_PROVISIONER_BEARER_TOKEN,
			config.INTENT_SERVICE_RUNTIME_ROLE,
			config.INTENT_SERVICE_RUNTIME_PASSWORD
		]
		if (intentProvisioningValues.some(Boolean) && !intentProvisioningValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['INTENT_SERVICE_PROVISIONER_BASE_URL'],
				message:
					'intent provisioner URL/token and runtime role/password must be configured together'
			})
		}
		const artifactProvisioningValues = [
			config.ARTIFACT_STORE_PROVISIONER_BASE_URL,
			config.ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN,
			config.ARTIFACT_STORE_RUNTIME_ROLE,
			config.ARTIFACT_STORE_RUNTIME_PASSWORD
		]
		if (artifactProvisioningValues.some(Boolean) && !artifactProvisioningValues.every(Boolean)) {
			context.addIssue({
				code: 'custom',
				path: ['ARTIFACT_STORE_PROVISIONER_BASE_URL'],
				message: 'provisioner URL/token and runtime role/password must be configured together'
			})
		}
		const publicUrl = new URL(config.PUBLIC_BASE_URL)
		if (publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
			context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'must be an origin' })
		}
		if (config.WEBAUTHN_RP_ID !== publicUrl.hostname) {
			context.addIssue({
				code: 'custom',
				path: ['WEBAUTHN_RP_ID'],
				message: 'must equal the public hostname'
			})
		}
		if (config.NODE_ENV === 'production') {
			if (publicUrl.protocol !== 'https:')
				context.addIssue({ code: 'custom', path: ['PUBLIC_BASE_URL'], message: 'must use HTTPS' })
		}
	})

export type ServerConfig = z.infer<typeof serverConfigSchema>
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	return serverConfigSchema.parse(env)
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const config = loadServerConfig(env)
	if (config.BETTER_AUTH_SECRET.length < 32) throw new Error('BETTER_AUTH_SECRET is required.')
	if (!validEncryptionKey(config.EMAIL_QUEUE_ENCRYPTION_KEY))
		throw new Error('EMAIL_QUEUE_ENCRYPTION_KEY must decode to 32 bytes.')
	if (!config.DOWNLOAD_URL && config.NODE_ENV === 'production')
		throw new Error('DOWNLOAD_URL is required.')
	if (
		config.NODE_ENV === 'production' &&
		Buffer.from(config.EMAIL_QUEUE_ENCRYPTION_KEY, 'base64').every((byte) => byte === 0)
	)
		throw new Error('EMAIL_QUEUE_ENCRYPTION_KEY must not be the all-zero key.')
	if (config.NODE_ENV === 'production' && !config.POLAR_API_KEY && !config.ALLOW_FAKE_PAYMENTS)
		throw new Error('POLAR_API_KEY is required.')
	if (config.POLAR_API_KEY && config.POLAR_WEBHOOK_SECRET === 'dev-fake-webhook-secret')
		throw new Error('POLAR_WEBHOOK_SECRET is required.')
	// The SSOT owns the avenNAME price (wire key `aven-name`) — a diverging env
	// override would let the funnel display one number and the provider charge
	// another.
	if (config.NAME_PRICE_EUR !== plan('aven-name').eurPrice)
		throw new Error(
			'NAME_PRICE_EUR must match the avenNAME price (wire key aven-name) in @myavenceo/aven-ceo/pricing.'
		)
	return config
}

export function loadEmailWorkerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const config = loadServerConfig(env)
	if (!validEncryptionKey(config.EMAIL_QUEUE_ENCRYPTION_KEY))
		throw new Error('EMAIL_QUEUE_ENCRYPTION_KEY must decode to 32 bytes.')
	if (!config.SMTP_URL || !config.SMTP_FROM) throw new Error('SMTP_URL and SMTP_FROM are required.')
	return config
}

export function loadEnvironmentWorkerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const config = loadServerConfig(env)
	if (!config.PROVISIONER_DATABASE_URL) throw new Error('PROVISIONER_DATABASE_URL is required.')
	return config
}

export type EmailWorkerConfig = Pick<
	ServerConfig,
	| 'APPLICATION_VERSION'
	| 'SMTP_URL'
	| 'SMTP_FROM'
	| 'SMTP_REPLY_TO'
	| 'EMAIL_WORKER_POLL_INTERVAL_MS'
	| 'EMAIL_WORKER_BATCH_SIZE'
	| 'EMAIL_WORKER_LEASE_SECONDS'
	| 'EMAIL_WORKER_HEARTBEAT_SECONDS'
	| 'EMAIL_RETRY_BASE_SECONDS'
	| 'EMAIL_RETRY_MAX_SECONDS'
>
export type EnvironmentWorkerConfig = Pick<
	ServerConfig,
	| 'APPLICATION_VERSION'
	| 'PROVISIONER_DATABASE_URL'
	| 'ENVIRONMENT_WORKER_POLL_INTERVAL_MS'
	| 'ENVIRONMENT_WORKER_LEASE_SECONDS'
	| 'ENVIRONMENT_WORKER_HEARTBEAT_SECONDS'
	| 'ENVIRONMENT_RECONCILE_INTERVAL_SECONDS'
	| 'ENVIRONMENT_MAX_ATTEMPTS'
	| 'ENVIRONMENT_RETRY_BASE_SECONDS'
	| 'ENVIRONMENT_RETRY_MAX_SECONDS'
	| 'ARTIFACT_STORE_PROVISIONER_BASE_URL'
	| 'ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN'
	| 'ARTIFACT_STORE_RUNTIME_ROLE'
	| 'ARTIFACT_STORE_RUNTIME_PASSWORD'
	| 'ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL'
	| 'ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN'
	| 'ARTIFACT_PROCESSOR_RUNTIME_ROLE'
	| 'ARTIFACT_PROCESSOR_RUNTIME_PASSWORD'
	| 'INTENT_SERVICE_PROVISIONER_BASE_URL'
	| 'INTENT_SERVICE_PROVISIONER_BEARER_TOKEN'
	| 'INTENT_SERVICE_RUNTIME_ROLE'
	| 'INTENT_SERVICE_RUNTIME_PASSWORD'
>
export type NotifierConfig = Pick<ServerConfig, 'PUBLIC_BASE_URL'>
export type ArtifactStoreConfig = Pick<
	ServerConfig,
	'ARTIFACT_STORE_BASE_URL' | 'ARTIFACT_STORE_BEARER_TOKEN'
>
export type ArtifactProcessorConfig = Pick<
	ServerConfig,
	'ARTIFACT_PROCESSOR_BASE_URL' | 'ARTIFACT_PROCESSOR_BEARER_TOKEN'
>
export type IntentServiceConfig = Pick<
	ServerConfig,
	'INTENT_SERVICE_BASE_URL' | 'INTENT_SERVICE_BEARER_TOKEN'
>
export type BillingConfig = Pick<
	ServerConfig,
	| 'PUBLIC_BASE_URL'
	| 'POLAR_API_KEY'
	| 'POLAR_SERVER'
	| 'POLAR_ORGANIZATION_ID'
	| 'POLAR_WEBHOOK_SECRET'
>
export type NameServiceConfig = Pick<
	ServerConfig,
	'PUBLIC_BASE_URL' | 'NAME_PRICE_EUR' | 'NAME_HOLD_TTL_HOURS' | 'NAME_RESERVATION_TTL_MINUTES'
>
