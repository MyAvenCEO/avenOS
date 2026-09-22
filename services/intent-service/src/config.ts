import { z } from 'zod'

export const intentServiceConfigSchema = z
	.object({
		PORT: z.coerce.number().int().positive().default(3010),
		CUSTOMER_DATABASE_HOST: z.string().min(1),
		CUSTOMER_DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		CUSTOMER_DATABASE_SSL: z.stringbool().default(false),
		CUSTOMER_RUNTIME_ID: z
			.string()
			.regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
			.default('primary'),
		INTENT_DATABASE_CREDENTIAL_ROOT: z.string().min(32),
		PRODUCTIVITY_DATABASE_CREDENTIAL_ROOT: z.string().min(32),
		INTENT_SERVICE_BEARER_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
		IDENTITY_ISSUER: z.url().default('https://aven.id'),
		IDENTITY_JWKS_URL: z.url().optional(),
		IDENTITY_AUDIENCE: z.string().min(1).default('aven-services'),
		TENANT_GRANT_ISSUER: z.url().default('https://api.aven.ceo'),
		TENANT_GRANT_PUBLIC_KEY: z.string().min(1),
		WORK_CONTROL_URL: z.url().optional(),
		WORK_GRANT_EXCHANGE_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		ACTOR_RUNNER_BASE_URL: z.url().optional(),
		ACTOR_RUNNER_SERVICE_BEARER_TOKEN: z.string().min(32).optional()
	})
	.superRefine((config, context) => {
		const fields = [
			'WORK_CONTROL_URL',
			'WORK_GRANT_EXCHANGE_BEARER_TOKEN',
			'ACTOR_RUNNER_BASE_URL',
			'ACTOR_RUNNER_SERVICE_BEARER_TOKEN'
		] as const
		if (fields.some((field) => config[field] !== undefined))
			for (const field of fields)
				if (!config[field])
					context.addIssue({
						code: 'custom',
						path: [field],
						message: 'Configure all background-work destinations and credentials together.'
					})
	})

export type IntentServiceConfig = z.infer<typeof intentServiceConfigSchema>
export const loadIntentServiceConfig = (env: NodeJS.ProcessEnv = process.env) =>
	intentServiceConfigSchema.parse(env)
