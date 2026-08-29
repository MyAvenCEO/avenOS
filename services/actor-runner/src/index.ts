import { createActorPlanExecutor } from '@avenos/actors'
import { importTenantGrantPublicKey } from '@avenos/aven-customer-contracts'
import { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { IdentityVerifier } from '@avenos/aven-identity'
import { loadActorRunnerConfig } from './config.js'
import { createActorRunnerHandler } from './handler.js'
import { createServerActorExecutionHost } from './host.js'
import { SqlPlanRunner } from './sql-runner.js'

const config = loadActorRunnerConfig()
const componentRef = 'os.aven:component:actors:run-repository@1'
const apiPools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.ACTOR_API_DB_CREDENTIAL_ROOT,
	roleKind: 'os.aven:db-role:actors:api@1',
	roleSuffix: 'act_api',
	componentRef,
	searchPath: ['aven_actor_runs']
})
const workerPools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.ACTOR_WORKER_DB_CREDENTIAL_ROOT,
	roleKind: 'os.aven:db-role:actors:worker@1',
	roleSuffix: 'act_worker',
	componentRef,
	searchPath: ['aven_actor_runs']
})
const tenantGrantPublicKey = await importTenantGrantPublicKey(config.TENANT_GRANT_PUBLIC_KEY)
const execute = createActorPlanExecutor(createServerActorExecutionHost())
const handler = createActorRunnerHandler(
	{
		forGrant: async (grant) => {
			const [api, worker] = await Promise.all([
				apiPools.forGrant(grant),
				workerPools.forGrant(grant)
			])
			const runner = new SqlPlanRunner(api, worker, execute)
			await runner.recoverAcceptedRuns()
			return runner
		}
	},
	new IdentityVerifier({
		issuer: config.IDENTITY_ISSUER,
		audience: config.IDENTITY_AUDIENCE,
		jwksUrl: config.IDENTITY_JWKS_URL
	}),
	{
		serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	}
)

Bun.serve({
	port: config.PORT,
	fetch: handler,
	error() {
		return new Response('Service unavailable', { status: 500 })
	}
})

console.info(
	JSON.stringify({
		level: 'info',
		service: 'actor-runner',
		authority: 'os.aven',
		stateBackend: 'customer-postgresql',
		port: config.PORT
	})
)
