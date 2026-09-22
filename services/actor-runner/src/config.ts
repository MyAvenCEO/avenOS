import { z } from 'zod'

export const actorRunnerConfigSchema = z
	.object({
		PORT: z.coerce.number().int().positive().default(3010),
		IDENTITY_ISSUER: z.url().default('https://aven.id'),
		IDENTITY_JWKS_URL: z.url().optional(),
		IDENTITY_AUDIENCE: z.string().min(1).default('aven-services'),
		ACTOR_RUNNER_SERVICE_BEARER_TOKEN: z.string().min(32),
		TENANT_GRANT_ISSUER: z.url().default('https://api.aven.ceo'),
		TENANT_GRANT_PUBLIC_KEY: z.string().min(1),
		CUSTOMER_DATABASE_HOST: z.string().min(1),
		CUSTOMER_DATABASE_PORT: z.coerce.number().int().positive().default(5432),
		CUSTOMER_DATABASE_SSL: z.stringbool().default(false),
		CUSTOMER_RUNTIME_ID: z.string().min(1).max(80).default('primary'),
		ACTOR_API_DB_CREDENTIAL_ROOT: z.string().min(32),
		ACTOR_WORKER_DB_CREDENTIAL_ROOT: z.string().min(32),
		ARTIFACT_STORE_BASE_URL: z.url(),
		ARTIFACT_STORE_BEARER_TOKEN: z.string().min(32),
		LLM_GATEWAY_BASE_URL: z.url(),
		LLM_GATEWAY_BEARER_TOKEN: z.string().min(32),
		DOCUMENT_MODEL_ID: z.string().min(1).optional(),
		CONNECTION_RUNTIME_JSON: z
			.string()
			.transform((value) => JSON.parse(value))
			.pipe(
				z
					.object({
						metadataUrl: z.url(),
						policyUrl: z.url(),
						policyToken: z.string().min(32),
						http: z.object({ url: z.url(), token: z.string().min(32) }).strict(),
						imap: z.object({ url: z.url(), token: z.string().min(32) }).strict(),
						publisher: z.object({ issuer: z.string().min(1), subject: z.string().min(1) }).strict()
					})
					.strict()
			)
			.optional(),
		ACTOR_RUNNER_MAX_PARALLELISM: z.coerce.number().int().min(1).max(32).default(5),
		WORK_CONTROL_URL: z.url().optional(),
		WORK_GRANT_EXCHANGE_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		INTENT_SERVICE_BASE_URL: z.url().optional(),
		INTENT_SERVICE_BEARER_TOKEN: z
			.string()
			.regex(/^[A-Za-z0-9_-]{32,128}$/)
			.optional(),
		CHAT_MODEL_ID: z.string().min(1).optional()
	})
	.superRefine((config, context) => {
		const fields = [
			'WORK_CONTROL_URL',
			'WORK_GRANT_EXCHANGE_BEARER_TOKEN',
			'INTENT_SERVICE_BASE_URL',
			'INTENT_SERVICE_BEARER_TOKEN',
			'CHAT_MODEL_ID'
		] as const
		if (fields.some((field) => config[field] !== undefined))
			for (const field of fields)
				if (!config[field])
					context.addIssue({
						code: 'custom',
						path: [field],
						message:
							'Configure all background-work destinations, credentials and the chat model together.'
					})
	})

export type ActorRunnerConfig = z.infer<typeof actorRunnerConfigSchema>

export const loadActorRunnerConfig = (env: NodeJS.ProcessEnv = process.env): ActorRunnerConfig =>
	actorRunnerConfigSchema.parse(env)
