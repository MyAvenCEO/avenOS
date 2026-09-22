import type { PlanRunExecutionContext, PlanRunStartRequest } from '@avenos/actors'
import { createActorPlanExecutor, TrustedActorInstallations } from '@avenos/actors'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import { importTenantGrantPublicKey, type TenantGrantClaims } from '@avenos/aven-customer-contracts'
import {
	createWorkGuardHandler,
	TenantPoolProvider,
	WorkerPlacementClient
} from '@avenos/aven-customer-runtime'
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
import { AdmittedInvocations } from './admitted-invocations.js'
import { createApplicationExecutor } from './application-executor.js'
import { type BackgroundChatConfig, createBackgroundChatHost } from './background-chat.js'
import {
	createCalculationRuntimeFactory,
	installCalculationRuntimeActor
} from './calculation-runtime.js'
import { CHAT_TURN_SKILL, createChatTurnExecutor } from './chat-executor.js'
import { readChatProgress } from './chat-progress.js'
import { loadActorRunnerConfig } from './config.js'
import { installConnectionActors } from './connection-manifests.js'
import { ConnectionRuntime, createConnectionFactories } from './connection-runtime.js'
import { createDocumentCatalogSource } from './document-catalog.js'
import { createDocumentRuntimeFactories, installDocumentRuntimeActors } from './document-runtime.js'
import { deployedChatEngineDigest } from './engine-fingerprint.js'
import { createActorRunnerHandler } from './handler.js'
import { createServerActorExecutionHost } from './host.js'
import { createHttpContentFactory, installHttpContentActor } from './http-content-runtime.js'
import { installedAuthorizer, installedRegistry } from './installed-runtime.js'
import {
	createIntentArtifactRuntimeFactory,
	installIntentArtifactRuntimeActor
} from './intent-artifact-runtime.js'
import { createInvocationGuardHandler } from './invocation-guard-handler.js'
import { createKnowledgeRuntimeFactory, installKnowledgeRuntimeActor } from './knowledge-runtime.js'
import { createLlmRuntimeFactory, installLlmRuntimeActor } from './llm-runtime.js'
import { createMailContentFactory, installMailContentActor } from './mail-content-runtime.js'
import { createMarkdownRuntimeFactory, installMarkdownRuntimeActor } from './markdown-runtime.js'
import { ActorRecoveryWorker } from './recovery-worker.js'
import { createReportRuntimeFactory, installReportRuntimeActor } from './report-runtime.js'
import { ReviewStore } from './reviews.js'
import { SqlPlanRunner } from './sql-runner.js'
import { StudioArtifacts } from './studio-artifacts.js'
import { createStudioRuntimeFactory, installStudioRuntimeActors } from './studio-runtime.js'
import { StudioService } from './studio-service.js'
import { createStudioV2Executor, STUDIO_SKILL_V2 } from './studio-v2-executor.js'
import { createTurnAdmissionHandler } from './turn-admission-handler.js'
import { createTurnStatusHandler } from './turn-status-handler.js'
import { assertWorkLease } from './work-lease.js'

const config = loadActorRunnerConfig()
const studioInstallations = new TrustedActorInstallations()
await installStudioRuntimeActors(studioInstallations)
await installDocumentRuntimeActors(studioInstallations)
await installMarkdownRuntimeActor(studioInstallations)
await installReportRuntimeActor(studioInstallations)
await installLlmRuntimeActor(studioInstallations)
await installHttpContentActor(studioInstallations)
await installMailContentActor(studioInstallations)
await installCalculationRuntimeActor(studioInstallations)
await installKnowledgeRuntimeActor(studioInstallations)
await installIntentArtifactRuntimeActor(studioInstallations)
if (config.CONNECTION_RUNTIME_JSON) await installConnectionActors(studioInstallations)
const componentRef = 'os.aven:component:actors:run-repository@1'
const runners = new WeakMap<
	pg.Pool,
	{
		runner: SqlPlanRunner
		studio: StudioService
		api: pg.Pool
		worker: pg.Pool
		admissions: AdmittedInvocations
	}
>()
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
const turnStatus = createTurnStatusHandler(
	{
		serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
		runtimeId: config.CUSTOMER_RUNTIME_ID,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey
	},
	(placement) => apiPools.forPlacement(placement),
	(error) => console.error('Turn status check failed', error)
)
const workGuard = createWorkGuardHandler(
	{
		serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
		tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
		tenantGrantPublicKey,
		componentRef,
		requiredAction: 'actor-runs:read'
	},
	async (tenant, work) => assertWorkLease(await apiPools.forGrant(tenant), work, tenant.execution!),
	(error) => console.error('Work lease check failed', error)
)
const modelGateway = new HttpLlmGatewayClient({
	baseUrl: config.LLM_GATEWAY_BASE_URL,
	bearerToken: config.LLM_GATEWAY_BEARER_TOKEN
})
const documentModel = new LlmDocumentModelGateway(modelGateway, config.DOCUMENT_MODEL_ID)
const chatConfig: BackgroundChatConfig | undefined = config.WORK_CONTROL_URL
	? {
			controlUrl: config.WORK_CONTROL_URL,
			exchangeToken: config.WORK_GRANT_EXCHANGE_BEARER_TOKEN!,
			intentUrl: config.INTENT_SERVICE_BASE_URL!,
			intentToken: config.INTENT_SERVICE_BEARER_TOKEN!,
			artifactUrl: config.ARTIFACT_STORE_BASE_URL,
			artifactToken: config.ARTIFACT_STORE_BEARER_TOKEN,
			runtimeId: config.CUSTOMER_RUNTIME_ID,
			issuer: config.TENANT_GRANT_ISSUER,
			publicKey: tenantGrantPublicKey,
			modelId: config.CHAT_MODEL_ID!,
			engineDigest: await deployedChatEngineDigest(config.CHAT_MODEL_ID!)
		}
	: undefined
// Interactive admission and cold worker discovery share this exact composition.
// A signed placement selects only the component pool, never a fabricated user.
const runtimeFor = (
	grant: Pick<TenantGrantClaims, 'databaseName' | 'environmentId' | 'routingGeneration'>,
	api: pg.Pool,
	worker: pg.Pool
) => {
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
	const documentDependencies = {
		model: documentModel,
		artifactsFor: (request: import('@avenos/actors').PlanRunStartRequest) => ({
			client: artifactClient,
			scopeId: grant.environmentId,
			userId: request.security.principal.subjectId
		})
	}
	const documents = createDocumentSkillExecutor(documentDependencies)
	const studioArtifacts = new StudioArtifacts(artifactClient, grant.environmentId)
	const admissions = new AdmittedInvocations(
		{ environmentId: grant.environmentId, generation: grant.routingGeneration },
		worker
	)
	const connectionAttempts = new WeakMap<PlanRunExecutionContext, ConnectionRuntime>()
	const connectionsFor = (request: PlanRunStartRequest, context?: PlanRunExecutionContext) => {
		if (!config.CONNECTION_RUNTIME_JSON) return undefined
		if (!context) throw Error('CONNECTION_EXECUTION_CONTEXT_REQUIRED')
		let connection = connectionAttempts.get(context)
		if (!connection) {
			connection = new ConnectionRuntime(
				config.CONNECTION_RUNTIME_JSON,
				studioArtifacts,
				admissions,
				new ReviewStore(worker, {
					environmentId: grant.environmentId,
					generation: grant.routingGeneration,
					subjectId: request.security.principal.subjectId
				}),
				request,
				context
			)
			connectionAttempts.set(context, connection)
		}
		return connection
	}
	const studioFactories = [
		createHttpContentFactory(studioArtifacts),
		createMailContentFactory(studioArtifacts),
		...(config.CONNECTION_RUNTIME_JSON ? createConnectionFactories(studioArtifacts) : []),
		createStudioRuntimeFactory(),
		...createDocumentRuntimeFactories(studioArtifacts, documentModel),
		createMarkdownRuntimeFactory(studioArtifacts),
		createCalculationRuntimeFactory(studioArtifacts),
		createKnowledgeRuntimeFactory(studioArtifacts),
		createLlmRuntimeFactory(studioArtifacts, modelGateway, config.DOCUMENT_MODEL_ID),
		createIntentArtifactRuntimeFactory(studioArtifacts),
		createReportRuntimeFactory(studioArtifacts, documentModel)
	]
	const studioOffers = studioFactories.map((f) => f.offer)
	const catalog = createDocumentCatalogSource(
		grant.environmentId,
		studioInstallations,
		studioOffers
	)
	let runner: SqlPlanRunner
	const chat = chatConfig
		? createBackgroundChatHost(
				chatConfig,
				{ environmentId: grant.environmentId, generation: grant.routingGeneration, worker },
				{
					pools: apiPools,
					workerPools,
					runner: () => runner,
					catalog,
					installations: studioInstallations,
					model: modelGateway
				}
			)
		: undefined
	const studioRegistry = installedRegistry(studioInstallations, studioOffers)
	const studioAuthorizer = installedAuthorizer(grant.environmentId, studioInstallations)
	const execute = createApplicationExecutor(
		[
			...(chat ? [{ skillRef: CHAT_TURN_SKILL, execute: createChatTurnExecutor(chat) }] : []),
			{
				skillRef: STUDIO_SKILL_V2,
				execute: createStudioV2Executor(studioArtifacts, {
					invocationHostFor: (request, context) =>
						connectionsFor(request, context)?.host() ?? {
							invoke: (_invocation, dispatch) => dispatch()
						},
					committedOutputsFor: async (request, context, step, capability) =>
						connectionsFor(request, context)?.takeOutputs(step, capability),
					reviewsFor: (request) =>
						new ReviewStore(worker, {
							environmentId: grant.environmentId,
							generation: grant.routingGeneration,
							subjectId: request.security.principal.subjectId
						}),
					registryFor: () => studioRegistry.snapshot(),
					authorizerFor: () => studioAuthorizer,
					factoriesFor: (request, signal, context) => {
						const factories = [
							createHttpContentFactory(studioArtifacts),
							createMailContentFactory(studioArtifacts),
							...(connectionsFor(request, context)?.factories() ?? []),
							createStudioRuntimeFactory(),
							...createDocumentRuntimeFactories(studioArtifacts, documentModel, { signal }),
							createMarkdownRuntimeFactory(studioArtifacts),
							createCalculationRuntimeFactory(studioArtifacts),
							createKnowledgeRuntimeFactory(studioArtifacts),
							createLlmRuntimeFactory(
								studioArtifacts,
								modelGateway,
								config.DOCUMENT_MODEL_ID,
								signal
							),
							createIntentArtifactRuntimeFactory(studioArtifacts),
							createReportRuntimeFactory(studioArtifacts, documentModel, signal)
						]
						return {
							resolve: (factoryId) => factories.find((f) => f.offer.factoryId === factoryId)
						}
					},
					installations: studioInstallations
				})
			},
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
	runner = new SqlPlanRunner(
		api,
		worker,
		execute,
		true,
		15 * 60_000,
		config.ACTOR_RUNNER_MAX_PARALLELISM,
		chat ? (record) => chat.ready(record) : undefined,
		(record) => (record.skillRef === CHAT_TURN_SKILL ? chatConfig?.engineDigest : undefined)
	)
	const entry = {
		runner,
		studio: new StudioService(api, studioArtifacts, runner, catalog, studioInstallations),
		api,
		worker,
		admissions
	}
	runners.set(api, entry)
	runners.set(worker, entry)
	void runner.recoverAcceptedRuns().catch((error) => console.error('Actor recovery failed', error))
	return runner
}
const forGrant = async (grant: TenantGrantClaims) => {
	const [api, worker] = await Promise.all([apiPools.forGrant(grant), workerPools.forGrant(grant)])
	return runtimeFor(grant, api, worker)
}
const invocationGuard = createInvocationGuardHandler(
	{
		serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
		issuer: config.TENANT_GRANT_ISSUER,
		key: tenantGrantPublicKey
	},
	new IdentityVerifier({
		issuer: config.IDENTITY_ISSUER,
		audience: config.IDENTITY_AUDIENCE,
		jwksUrl: config.IDENTITY_JWKS_URL
	}),
	async (grant) => {
		await forGrant(grant)
		return runners.get(await apiPools.forGrant(grant))!.admissions
	}
)
const turnAdmission = chatConfig
	? createTurnAdmissionHandler(
			{
				serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
				tenantGrantIssuer: config.TENANT_GRANT_ISSUER,
				tenantGrantPublicKey
			},
			forGrant,
			(error) => console.error('Turn admission failed', error)
		)
	: undefined
const recovery = chatConfig
	? new ActorRecoveryWorker({
			placements: new WorkerPlacementClient({
				baseUrl: chatConfig.controlUrl,
				serviceToken: config.ACTOR_RUNNER_SERVICE_BEARER_TOKEN,
				runtimeId: config.CUSTOMER_RUNTIME_ID,
				issuer: config.TENANT_GRANT_ISSUER,
				publicKey: tenantGrantPublicKey,
				componentRef
			}),
			recover: async (placement, signal) => {
				const [api, worker] = await Promise.all([
					apiPools.forPlacement(placement),
					workerPools.forPlacement(placement)
				])
				signal.throwIfAborted()
				await runtimeFor(placement, api, worker).recoverAcceptedRuns()
			},
			report: (summary) => {
				if (summary.failed || summary.directoryFailed)
					console.warn(JSON.stringify({ event: 'actor-recovery-sweep', ...summary }))
			}
		})
	: undefined
const handler = createActorRunnerHandler(
	{
		forGrant,
		reviewsForGrant: async (grant) =>
			new ReviewStore(await apiPools.forGrant(grant), {
				environmentId: grant.environmentId,
				generation: grant.routingGeneration,
				subjectId: grant.sub
			}),
		chatProgress: async (grant, turnId) =>
			readChatProgress(await apiPools.forGrant(grant), grant.sub, turnId),
		studioForGrant: async (grant) => {
			const api = await apiPools.forGrant(grant)
			const entry = runners.get(api)
			if (!entry) throw new Error('Studio runtime has not been admitted.')
			return entry.studio
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
		const path = new URL(request.url).pathname
		if (path === '/internal/v1/invocations/read') return invocationGuard(request)
		const response = await (path === '/internal/v1/work/verify'
			? workGuard
			: path === '/internal/v1/work/admit' && turnAdmission
				? turnAdmission
				: path === '/internal/v1/work/turn/status'
					? turnStatus
					: handler)(request)
		boundary.record(response.status, server.requestIP(request)?.address)
		return response
	},
	error() {
		return new Response('Service unavailable', { status: 500 })
	}
})
recovery?.start()

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
	await recovery?.close()
	await Promise.all([apiPools.close(), workerPools.close()])
}
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		void shutdown().then(
			() => process.exit(0),
			() => process.exit(1)
		)
	})
