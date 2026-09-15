import { createActorPlanExecutor } from '@avenos/actors'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import { importTenantGrantPublicKey } from '@avenos/aven-customer-contracts'
import { TenantPoolProvider } from '@avenos/aven-customer-runtime'
import { IdentityVerifier } from '@avenos/aven-identity'
import { DOCUMENT_INGEST_SKILL } from '@avenos/document-ingest/execution'
import { LlmDocumentModelGateway } from '@avenos/document-ingest/llm-gateway'
import { RECONCILIATION_SKILL } from '@avenos/document-ingest/reconciliation-flow'
import {
	createDocumentSkillExecutor,
	createReconciliationSkillExecutor
} from '@avenos/document-ingest/server'
import { BoundarySignals } from '@avenos/http-boundary'
import { HttpLlmGatewayClient } from '@avenos/llm-client/http'
import type pg from 'pg'
import { createApplicationExecutor } from './application-executor.js'
import { loadActorRunnerConfig } from './config.js'
import { createActorRunnerHandler } from './handler.js'
import { createServerActorExecutionHost } from './host.js'
import { SqlPlanRunner } from './sql-runner.js'

const config = loadActorRunnerConfig()
const componentRef = 'os.aven:component:actors:run-repository@1'
const runners = new WeakMap<pg.Pool, { runner: SqlPlanRunner; api: pg.Pool; worker: pg.Pool }>()
const drains = new WeakMap<pg.Pool, Promise<void>>()
const evict = async (pool: pg.Pool) => {
	const entry = runners.get(pool)
	if (entry) {
		const drain = entry.runner.close()
		drains.set(entry.api, drain)
		drains.set(entry.worker, drain)
		runners.delete(entry.api)
		runners.delete(entry.worker)
	}
	await drains.get(pool)
}
const apiPools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.ACTOR_API_DB_CREDENTIAL_ROOT,
	roleKind: 'os.aven:db-role:actors:api@1',
	roleSuffix: 'act_api',
	componentRef,
	searchPath: ['aven_actor_runs'],
	canEvict: (pool) => !runners.get(pool)?.runner.busy,
	onEvict: evict
})
const workerPools = new TenantPoolProvider({
	host: config.CUSTOMER_DATABASE_HOST,
	port: config.CUSTOMER_DATABASE_PORT,
	ssl: config.CUSTOMER_DATABASE_SSL,
	credentialRoot: config.ACTOR_WORKER_DB_CREDENTIAL_ROOT,
	roleKind: 'os.aven:db-role:actors:worker@1',
	roleSuffix: 'act_worker',
	componentRef,
	searchPath: ['aven_actor_runs'],
	canEvict: (pool) => !runners.get(pool)?.runner.busy,
	onEvict: evict
})
const tenantGrantPublicKey = await importTenantGrantPublicKey(config.TENANT_GRANT_PUBLIC_KEY)
const documentModel = new LlmDocumentModelGateway(
	new HttpLlmGatewayClient({
		baseUrl: config.LLM_GATEWAY_BASE_URL,
		bearerToken: config.LLM_GATEWAY_BEARER_TOKEN
	}),
	config.DOCUMENT_MODEL_ID
)
const handler = createActorRunnerHandler(
	{
		forGrant: async (grant) => {
			const [api, worker] = await Promise.all([
				apiPools.forGrant(grant),
				workerPools.forGrant(grant)
			])
			const cached = runners.get(api)
			if (cached) return cached.runner
			const artifactClient = new ArtifactStoreClient({
				baseUrl: config.ARTIFACT_STORE_BASE_URL,
				bearerToken: () => config.ARTIFACT_STORE_BEARER_TOKEN,
				requestHeaders: () => ({
					'x-aven-artifact-database': grant.databaseName,
					'x-aven-environment': grant.environmentId,
					'x-aven-routing-generation': String(grant.routingGeneration)
				})
			})
			const documents = createDocumentSkillExecutor({
				model: documentModel,
				artifactsFor: (request) => ({
					client: artifactClient,
					scopeId: grant.environmentId,
					userId: request.security.principal.subjectId
				})
			})
			const execute = createApplicationExecutor(
				[
					{ skillRef: DOCUMENT_INGEST_SKILL, execute: documents },
					{
						skillRef: RECONCILIATION_SKILL,
						execute: createReconciliationSkillExecutor({
							artifactsFor: (request) => ({
								client: artifactClient,
								scopeId: grant.environmentId,
								userId: request.security.principal.subjectId
							})
						})
					}
				],
				createActorPlanExecutor(createServerActorExecutionHost())
			)
			const runner = new SqlPlanRunner(
				api,
				worker,
				execute,
				true,
				15 * 60_000,
				config.ACTOR_RUNNER_MAX_PARALLELISM
			)
			const entry = { runner, api, worker }
			runners.set(api, entry)
			runners.set(worker, entry)
			void runner
				.recoverAcceptedRuns()
				.catch((error) => console.error('Actor recovery failed', error))
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

const boundary = new BoundarySignals('facade-to-runner', (summary) =>
	console.warn(JSON.stringify(summary))
)
const server = Bun.serve({
	port: config.PORT,
	async fetch(request, server) {
		const response = await handler(request)
		boundary.record(response.status, server.requestIP(request)?.address)
		return response
	},
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

let stopping = false
async function shutdown(): Promise<void> {
	if (stopping) return
	stopping = true
	await server.stop(true)
	await Promise.all([apiPools.close(), workerPools.close()])
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		void shutdown().then(
			() => process.exit(0),
			() => process.exit(1)
		)
	})
