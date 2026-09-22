import { importTenantGrantPublicKey } from '@avenos/aven-customer-contracts'
import { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { IdentityVerifier } from '@avenos/aven-identity'
import { BoundarySignals } from '@avenos/http-boundary'
import { SqlTaskRepository } from '@avenos/productivity/postgres'
import { PRODUCTIVITY_COMPONENT } from '@avenos/productivity/tasks'
import pino from 'pino'
import { loadIntentServiceConfig } from './config.js'
import { createIntentHandler } from './handler.js'
import { createProductivityHandler, createTaskIntentVerifier } from './productivity.js'
import { IntentStore } from './store.js'
import { createTurnLifecycleHandler } from './turn-lifecycle-handler.js'
import { IntentTurnOutbox } from './turn-outbox.js'
import { createIntentTurnRuntime } from './turn-runtime.js'
import { createTurnWorkHandler } from './turn-work-handler.js'
import { createIntentDispatchGuard, createIntentWorkGuard } from './work-guard.js'

const config = loadIntentServiceConfig()
const logger = pino({ redact: ['req.headers.authorization', 'req.headers.x-aven-identity-token'] })
const pools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.INTENT_DATABASE_CREDENTIAL_ROOT,
	roleKind: 'ceo.aven:db-role:intents:api@1',
	roleSuffix: 'int_api',
	componentRef: 'ceo.aven:component:data:intents@1',
	searchPath: ['aven_intents']
})
const tenantGrantPublicKey = await importTenantGrantPublicKey(config.TENANT_GRANT_PUBLIC_KEY)
const workGuard = createIntentWorkGuard(
	{
		serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	},
	async (grant) => new IntentTurnOutbox(await pools.forGrant(grant)),
	(error) => logger.error({ err: error }, 'Work check failed')
)
const turnWork = createTurnWorkHandler(
	{
		serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	},
	{
		outboxFor: async (grant) => new IntentTurnOutbox(await pools.forGrant(grant)),
		historyFor: async (grant) => new IntentStore(await pools.forGrant(grant))
	},
	(error) => logger.error({ err: error }, 'Turn context request failed')
)
const dispatchGuard = createIntentDispatchGuard(
	{
		serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	},
	async (grant) => new IntentTurnOutbox(await pools.forGrant(grant)),
	(error) => logger.error({ err: error }, 'Turn dispatch check failed')
)
const turnLifecycle = createTurnLifecycleHandler(
	{
		serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
		runtimeId: config.CUSTOMER_RUNTIME_ID,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	},
	async (placement) => new IntentTurnOutbox(await pools.forPlacement(placement)),
	(error) => logger.error({ err: error }, 'Turn lifecycle request failed')
)
const productivityPools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.PRODUCTIVITY_DATABASE_CREDENTIAL_ROOT,
	roleKind: 'ceo.aven:db-role:productivity:api@1',
	roleSuffix: 'prod_api',
	componentRef: PRODUCTIVITY_COMPONENT,
	searchPath: ['aven_productivity']
})
const verifier = new IdentityVerifier({
	issuer: config.IDENTITY_ISSUER,
	jwksUrl: config.IDENTITY_JWKS_URL,
	audience: config.IDENTITY_AUDIENCE
})
const productivity = createProductivityHandler(
	{
		serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
		issuer: config.TENANT_GRANT_ISSUER,
		key: tenantGrantPublicKey
	},
	verifier,
	{
		forGrant: async (grant) => new SqlTaskRepository(await productivityPools.forGrant(grant), grant)
	},
	createTaskIntentVerifier(
		{
			serviceToken: config.INTENT_SERVICE_BEARER_TOKEN,
			issuer: config.TENANT_GRANT_ISSUER,
			key: tenantGrantPublicKey
		},
		verifier,
		{ forGrant: async (grant) => new IntentStore(await pools.forGrant(grant)) }
	),
	(error) => logger.error({ err: error }, 'Task request failed')
)
const handler = createIntentHandler(
	config,
	verifier,
	tenantGrantPublicKey,
	{ forGrant: async (grant) => new IntentStore(await pools.forGrant(grant)) },
	(error) => logger.error({ err: error }, 'Intent request failed')
)

const boundary = new BoundarySignals('facade-to-intents', (summary) =>
	logger.warn(summary, 'Service boundary denials observed')
)
const server = Bun.serve({
	port: config.PORT,
	async fetch(request, server) {
		const path = new URL(request.url).pathname
		const response = await (path === '/internal/v1/work/verify'
			? workGuard
			: path === '/internal/v1/work/dispatch/verify'
				? dispatchGuard
				: path === '/internal/v1/work/turn/lifecycle'
					? turnLifecycle
					: path === '/internal/v1/work/turn'
						? turnWork
						: path.startsWith('/api/productivity/')
							? productivity
							: handler)(request)
		boundary.record(response.status, server.requestIP(request)?.address)
		return response
	},
	error(error) {
		logger.error({ err: error }, 'Intent server failed')
		return Response.json(
			{ code: 'INTENT_UNAVAILABLE', message: 'Intent state is unavailable.' },
			{ status: 500 }
		)
	}
})
logger.info({ port: config.PORT }, 'Intent Service listening')
const turns = config.WORK_CONTROL_URL
	? createIntentTurnRuntime(
			{
				controlUrl: config.WORK_CONTROL_URL,
				exchangeToken: config.WORK_GRANT_EXCHANGE_BEARER_TOKEN!,
				intentToken: config.INTENT_SERVICE_BEARER_TOKEN,
				runnerUrl: config.ACTOR_RUNNER_BASE_URL!,
				runnerToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN!,
				runtimeId: config.CUSTOMER_RUNTIME_ID,
				issuer: config.TENANT_GRANT_ISSUER,
				publicKey: tenantGrantPublicKey
			},
			pools,
			(mode, sweep) => {
				if (sweep.candidates || sweep.checked || sweep.failed || sweep.directoryFailed)
					logger.info({ event: 'intent-turn-sweep', mode, ...sweep }, 'Background work sweep')
			}
		)
	: undefined
turns?.start()
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		if (stopping) return
		stopping = true
		void Promise.resolve(turns?.close())
			.then(() => server.stop(true))
			.then(() => Promise.all([pools.close(), productivityPools.close()]))
			.then(
				() => process.exit(0),
				() => process.exit(1)
			)
	})
