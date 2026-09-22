import { importTenantGrantPublicKey } from '@avenos/aven-customer-contracts'
import { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { IdentityVerifier } from '@avenos/aven-identity'
import { loadCredentialSealer } from '@avenos/credential-storage/keys'
import { CredentialAdminStore, CredentialMetadataStore } from '@avenos/credential-storage/postgres'
import { z } from 'zod'
import { createCredentialHandler } from './handler'

const config = z
	.object({
		PORT: z.coerce.number().int().min(1).max(65535).default(3014),
		CUSTOMER_DATABASE_HOST: z.string().min(1),
		CUSTOMER_DATABASE_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
		CUSTOMER_DATABASE_SSL: z.stringbool().default(false),
		CREDENTIAL_SET_DB_CREDENTIAL_ROOT: z.string().min(43),
		CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT: z.string().min(43),
		CREDENTIAL_SERVICE_BEARER_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
		CREDENTIAL_SEALING_KEY_FILE: z.string().min(1),
		IDENTITY_ISSUER: z.url(),
		IDENTITY_JWKS_URL: z.url().optional(),
		IDENTITY_AUDIENCE: z.string().min(1).default('aven-services'),
		TENANT_GRANT_ISSUER: z.url(),
		TENANT_GRANT_PUBLIC_KEY: z.string().min(1)
	})
	.parse(process.env)
const pool = (suffix: string, kind: string, root: string) =>
	new TenantPoolProvider({
		host: config.CUSTOMER_DATABASE_HOST,
		port: config.CUSTOMER_DATABASE_PORT,
		ssl: config.CUSTOMER_DATABASE_SSL,
		credentialRoot: root,
		roleKind: `ceo.aven:db-role:credentials:${kind}@1`,
		roleSuffix: suffix,
		componentRef: 'ceo.aven:component:data:credentials@1',
		searchPath: ['aven_credentials']
	})
const admin = pool('cred_set', 'set', config.CREDENTIAL_SET_DB_CREDENTIAL_ROOT)
const metadata = pool('cred_meta', 'metadata', config.CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT)
const handler = createCredentialHandler(
	{
		serviceToken: config.CREDENTIAL_SERVICE_BEARER_TOKEN,
		issuer: config.TENANT_GRANT_ISSUER,
		key: await importTenantGrantPublicKey(config.TENANT_GRANT_PUBLIC_KEY)
	},
	new IdentityVerifier({
		issuer: config.IDENTITY_ISSUER,
		jwksUrl: config.IDENTITY_JWKS_URL,
		audience: config.IDENTITY_AUDIENCE
	}),
	{
		adminFor: async (grant) =>
			new CredentialAdminStore(await admin.forGrant(grant), {
				environmentId: grant.environmentId,
				subjectId: grant.sub,
				generation: grant.routingGeneration
			}),
		metadataFor: async (grant) =>
			new CredentialMetadataStore(await metadata.forGrant(grant), {
				environmentId: grant.environmentId,
				subjectId: grant.sub,
				generation: grant.routingGeneration
			})
	},
	await loadCredentialSealer(config.CREDENTIAL_SEALING_KEY_FILE)
)
const server = Bun.serve({
	port: config.PORT,
	maxRequestBodySize: 96 * 1024,
	fetch: (request) =>
		request.method === 'GET' && new URL(request.url).pathname === '/health/live'
			? Response.json({ status: 'ok' })
			: handler(request),
	error: () => Response.json({ code: 'CREDENTIAL_OPERATION_UNAVAILABLE' }, { status: 503 })
})
console.info(JSON.stringify({ event: 'credential-ingress-listening', port: server.port }))
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		void server
			.stop(true)
			.then(() => Promise.all([admin.close(), metadata.close()]))
			.finally(() => process.exit(0))
	})
