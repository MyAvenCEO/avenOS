import { importTenantGrantPublicKey } from '@avenos/aven-customer-contracts'
import { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { IdentityVerifier } from '@avenos/aven-identity'
import { loadCredentialUnsealer } from '@avenos/credential-storage/keys'
import { connectionExecutorConfig } from './config'
import { createConnectionExecutorHandler } from './handler'
import { connectionExecutorHost } from './runtime'

const config = connectionExecutorConfig.parse(process.env)
const protocol = config.CONNECTION_PROTOCOL
const pools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.CREDENTIAL_USE_DB_CREDENTIAL_ROOT,
	roleKind: `ceo.aven:db-role:credentials:use-${protocol}@1`,
	roleSuffix: `cred_${protocol}`,
	componentRef: 'ceo.aven:component:data:credentials@1',
	searchPath: ['aven_credentials']
})
const host = connectionExecutorHost(
	{
		protocol,
		policyUrl: config.CONNECTION_POLICY_URL,
		policyToken: config.CONNECTION_POLICY_VERIFY_TOKEN,
		issuer: config.CONNECTION_POLICY_ISSUER,
		publicKey: await importTenantGrantPublicKey(config.CONNECTION_POLICY_PUBLIC_KEY),
		artifactUrl: config.ARTIFACT_STORE_BASE_URL,
		artifactToken: config.ARTIFACT_STORE_BEARER_TOKEN,
		publisher: {
			issuer: config.CONNECTION_PUBLISHER_ISSUER,
			subject: config.CONNECTION_PUBLISHER_SUBJECT
		},
		allowedOrigins: config.CONNECTION_ALLOWED_ORIGINS
	},
	pools,
	await loadCredentialUnsealer(config.CREDENTIAL_UNSEALING_KEYS_FILE)
)
const handler = createConnectionExecutorHandler(
	{
		protocol,
		serviceToken: config.CONNECTION_SERVICE_BEARER_TOKEN,
		issuer: config.TENANT_GRANT_ISSUER,
		key: await importTenantGrantPublicKey(config.TENANT_GRANT_PUBLIC_KEY),
		maximumConcurrent: config.CONNECTION_MAX_PARALLELISM
	},
	new IdentityVerifier({
		issuer: config.IDENTITY_ISSUER,
		jwksUrl: config.IDENTITY_JWKS_URL,
		audience: config.IDENTITY_AUDIENCE
	}),
	host
)
const server = Bun.serve({
	port: config.PORT,
	maxRequestBodySize: 50 * 1024,
	fetch: (request) =>
		request.method === 'GET' && new URL(request.url).pathname === '/health/live'
			? Response.json({ status: 'ok' })
			: handler.handle(request),
	error: () => Response.json({ code: 'CONNECTION_UNAVAILABLE' }, { status: 503 })
})
console.info(
	JSON.stringify({ event: 'connection-executor-listening', protocol, port: server.port })
)
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		if (stopping) return
		stopping = true
		void (async () => {
			await handler.close()
			await server.stop(true)
			await pools.close()
		})().then(
			() => process.exit(0),
			() => process.exit(1)
		)
	})
