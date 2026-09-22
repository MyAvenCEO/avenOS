import { isAbsolute } from 'node:path'
import { z } from 'zod'

const origin = z
	.url()
	.refine((value) => value.startsWith('https://') && new URL(value).origin === value)
export const connectionExecutorConfig = z
	.object({
		PORT: z.coerce.number().int().min(1).max(65535).default(3015),
		CONNECTION_PROTOCOL: z.enum(['http', 'imap']),
		CONNECTION_SERVICE_BEARER_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
		CONNECTION_POLICY_URL: z.url(),
		CONNECTION_POLICY_VERIFY_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
		CONNECTION_POLICY_ISSUER: z.url(),
		CONNECTION_POLICY_PUBLIC_KEY: z.string().min(1),
		CONNECTION_ALLOWED_ORIGINS: z
			.string()
			.transform((value) => JSON.parse(value))
			.pipe(z.array(origin).min(1).max(64)),
		CONNECTION_MAX_PARALLELISM: z.coerce.number().int().min(1).max(32).default(4),
		CREDENTIAL_USE_DB_CREDENTIAL_ROOT: z.string().min(43),
		CREDENTIAL_UNSEALING_KEYS_FILE: z.string().refine(isAbsolute),
		CUSTOMER_DATABASE_HOST: z.string().min(1),
		CUSTOMER_DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
		CUSTOMER_DATABASE_SSL: z.stringbool().default(false),
		IDENTITY_ISSUER: z.url(),
		IDENTITY_JWKS_URL: z.url().optional(),
		IDENTITY_AUDIENCE: z.string().min(1).default('aven-services'),
		TENANT_GRANT_ISSUER: z.url(),
		TENANT_GRANT_PUBLIC_KEY: z.string().min(1),
		ARTIFACT_STORE_BASE_URL: z.url(),
		ARTIFACT_STORE_BEARER_TOKEN: z.string().min(32),
		CONNECTION_PUBLISHER_ISSUER: z.string().min(1),
		CONNECTION_PUBLISHER_SUBJECT: z.string().min(1)
	})
	.superRefine((config, context) => {
		if (config.CONNECTION_SERVICE_BEARER_TOKEN === config.CONNECTION_POLICY_VERIFY_TOKEN)
			context.addIssue({
				code: 'custom',
				message: 'Separate ingress and verification credentials are required.'
			})
	})
