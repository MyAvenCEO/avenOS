import { isAbsolute } from 'node:path'
import type { TenantGrantKey } from '@avenos/aven-customer-contracts'
import type { IdentityVerifier } from '@avenos/aven-identity'
import { loadConnectionPolicyKey } from '@avenos/credential-storage/keys'
import { z } from 'zod'
import type { FacadeConfig } from '../config'
import type { CustomerHandler } from '../customers/handler'
import { createConnectionPolicyHandler } from './handler'

const fields = [
	'CONNECTION_POLICY_KEY_FILE',
	'CONNECTION_POLICY_RUNNER_TOKEN',
	'CONNECTION_POLICY_VERIFY_TOKEN',
	'CONNECTION_POLICY_JSON'
] as const
const schema = z.object({
	CONNECTION_POLICY_KEY_FILE: z.string().refine(isAbsolute),
	CONNECTION_POLICY_RUNNER_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
	CONNECTION_POLICY_VERIFY_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
	CONNECTION_POLICY_JSON: z
		.string()
		.transform((value) => JSON.parse(value))
		.pipe(
			z
				.object({
					revision: z.number().int().positive(),
					httpTargets: z
						.array(z.object({ origin: z.url(), pathPrefix: z.string() }).strict())
						.max(64),
					imapOrigins: z.array(z.url()).max(64),
					maximumBytes: z
						.number()
						.int()
						.min(1)
						.max(32 * 1024 * 1024),
					maximumSeconds: z.number().int().min(1).max(60)
				})
				.strict()
		)
})

/** An absent deployment disables issuance; a partial deployment fails startup.
 * There is no wrapping key or protocol-use database role in this process. */
export async function configuredConnections(
	config: FacadeConfig,
	verifier: Pick<IdentityVerifier, 'verify'>,
	customers: Pick<CustomerHandler, 'grant'>,
	tenantPublicKey: TenantGrantKey,
	env: NodeJS.ProcessEnv = process.env
) {
	if (fields.every((field) => env[field] === undefined)) return undefined
	const parsed = schema.parse(env)
	return createConnectionPolicyHandler(
		config,
		{
			issuer: config.API_PUBLIC_BASE_URL,
			runnerToken: parsed.CONNECTION_POLICY_RUNNER_TOKEN,
			executorToken: parsed.CONNECTION_POLICY_VERIFY_TOKEN,
			...(await loadConnectionPolicyKey(parsed.CONNECTION_POLICY_KEY_FILE)),
			tenantPublicKey,
			policy: parsed.CONNECTION_POLICY_JSON
		},
		verifier,
		customers
	)
}
