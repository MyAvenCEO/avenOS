/** Actual outbox/runner/Chat/Tasks composition with Qwen. No customer records. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { journalDigest } from '@avenos/chat-engine/journal'
import type { ModelStream } from '@avenos/chat-engine/model'
import { answerReviewOptions } from '@avenos/chat-engine/research'
import type { InputAdmission } from '@avenos/intents/admission'
import { turnPageSchema, turnStopReceiptSchema } from '@avenos/intents/turn-status'
import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import {
	createKnowledgeActor,
	KNOWLEDGE_MANIFEST,
	parseStudioSkillV2,
	TrustedActorInstallations
} from '../../libs/aven-actors/src'
import { IdentityVerifier } from '../../libs/aven-identity/src'
import { HttpLlmGatewayClient } from '../../libs/aven-llm-client/src/http'
import type { InputRoute } from '../../libs/aven-llm-client/src/input-decision'
import {
	CHAT_TURN_SKILL,
	chatTurnParameters,
	createChatTurnExecutor
} from '../../services/actor-runner/src/chat-executor'
import { ChatTurnHost } from '../../services/actor-runner/src/chat-host'
import { SqlChatJournal } from '../../services/actor-runner/src/chat-journal'
import { createServerChatModel } from '../../services/actor-runner/src/chat-model'
import {
	readReplacementActions,
	readSettledChatReceipts,
	replacementActionsReady
} from '../../services/actor-runner/src/chat-receipts'
import { createChatActorTools } from '../../services/actor-runner/src/chat-tools'
import { createDocumentCatalogSource } from '../../services/actor-runner/src/document-catalog'
import { createHistoryActor } from '../../services/actor-runner/src/history-actor'
import {
	createMarkdownRuntimeFactory,
	installMarkdownRuntimeActor
} from '../../services/actor-runner/src/markdown-runtime'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import {
	type StudioArtifact,
	StudioArtifacts
} from '../../services/actor-runner/src/studio-artifacts'
import { StudioCases } from '../../services/actor-runner/src/studio-cases'
import { createFacadeHandler } from '../../services/aven-api/src/facade'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { IntentTurnDispatcher } from '../../services/intent-service/src/turn-dispatcher'
import { superviseTurns } from '../../services/intent-service/src/turn-supervision'
import type { IntentTurnWorker, TurnSweep } from '../../services/intent-service/src/turn-worker'
import { parsePlanAudit, planAuditMessages } from './plan-qualification'
import { taskServiceFixture } from './task-service-fixture'

const database = process.env.TEST_TASK_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL
assert(database && base, 'Use real Qwen and a disposable PostgreSQL server.')
const upstream =
	process.env.LIVE_LLM_MODEL ??
	(
		await fetch(`${base.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(10_000) }).then(
			(r) => {
				assert(r.ok, `Qwen model discovery HTTP ${r.status}`)
				return r.json()
			}
		)
	).data.find((m: any) => /qwen/i.test(m.id))?.id
assert(upstream && /qwen/i.test(upstream))
const modelServiceToken = randomUUID() + randomUUID()
const gatewayConfig = testConfig({
	LLM_GATEWAY_ENABLED: 'true',
	LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
	LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN: modelServiceToken,
	LLM_GATEWAY_TIMEOUT_SECONDS: '180',
	LLM_GATEWAY_MODELS_JSON: JSON.stringify([
		{
			id: 'proof-qwen',
			label: 'Qwen',
			baseUrl: base,
			upstreamModel: upstream,
			profile: 'qwen-tools',
			authMode: 'none',
			capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
		}
	])
})
const gateway = LlmGatewayService.fromConfig(gatewayConfig)!
const directory = await mkdtemp(join(tmpdir(), 'aven-live-dispatched-chat-'))
const evidence: any = {
	synthetic: true,
	passed: false,
	upstream,
	scope:
		'Signed HTTP discovery, runner admission, lifecycle recovery, context, publication and delegated Tasks; supervised delivery, real SQL runner and shared Chat. Process composition remains a fixture, not native or deployed background execution.',
	startedAt: new Date().toISOString(),
	models: [],
	routes: [],
	turns: [],
	qualityFailures: [],
	fingerprints: {}
}
// Keep evaluating independent later stages after a recovered tool mistake, but
// never call the journey passing. State/effect/authority failures still stop now.
function qualifyToolCalls(label: string, calls: Array<{ name: string; status: string }>) {
	const failed = calls.filter((call) => call.status === 'failed')
	if (failed.length) evidence.qualityFailures.push({ label, failed })
}
for (const file of [
	'deploy/e2e/plan-qualification.ts',
	'bun.lock',
	'services/actor-runner/src/chat-executor.ts',
	'services/actor-runner/src/chat-host.ts',
	'services/actor-runner/src/sql-runner.ts',
	'services/actor-runner/src/chat-model.ts',
	'services/aven-api/src/facade.ts',
	'libs/aven-chat-engine/src/gateway.ts',
	'libs/aven-llm-client/src/http.ts',
	'services/actor-runner/src/command.ts',
	'libs/aven-actors/src/run.ts',
	'libs/aven-actors/src/actor.ts',
	'libs/aven-chat-engine/src/tool-call.ts',
	'services/actor-runner/src/work-studio.ts',
	'libs/aven-actors/src/studio/agent.ts',
	'libs/aven-actors/src/studio/author.ts',
	'services/actor-runner/src/studio-v2-drafts.ts',
	'services/actor-runner/src/studio-draft-receipts.ts',
	'libs/aven-chat-engine/src/request-scope.ts',
	'services/platform-provisioner/components/actor-runs/0005_studio_draft_receipts.sql',
	'services/actor-runner/src/studio-errors.ts',
	'libs/aven-chat-engine/src/restored-history.ts',
	'libs/aven-chat-engine/src/history-selection.ts',
	'services/actor-runner/src/studio-service.ts',
	'services/actor-runner/src/studio-v2-authoring.ts',
	'services/actor-runner/src/studio-v2-publisher.ts',
	'services/actor-runner/src/studio-cases.ts',
	'services/actor-runner/src/work-artifacts.ts',
	'deploy/e2e/artifact-service-fixture.ts',
	'libs/aven-actors/src/knowledge.ts',
	'target/rust/debug/aven-artifact-store',
	'services/artifact-store/crates/server/src/lib.rs',
	'services/artifact-store/crates/postgres/src/library.rs',
	'services/actor-runner/src/chat-journal.ts',
	'services/actor-runner/src/chat-receipts.ts',
	'services/actor-runner/src/turn-observation.ts',
	'services/actor-runner/src/work-lease.ts',
	'services/intent-service/src/turn-dispatcher.ts',
	'services/intent-service/src/turn-worker.ts',
	'libs/aven-intents/src/work.ts',
	'libs/aven-intents/src/turn-status.ts',
	'services/intent-service/src/store.ts',
	'services/intent-service/src/handler.ts',
	'services/intent-service/src/turn-work-handler.ts',
	'services/actor-runner/src/turn-work-client.ts',
	'libs/aven-intents/src/retrieval.ts',
	'libs/aven-actors/src/retrieval.ts',
	'services/actor-runner/src/history-actor.ts',
	'services/actor-runner/src/chat-tools.ts',
	'services/actor-runner/src/turn-admission-handler.ts',
	'services/intent-service/src/turn-dispatch-client.ts',
	'services/intent-service/src/turn-lifecycle-handler.ts',
	'services/actor-runner/src/turn-lifecycle-client.ts',
	'services/actor-runner/src/turn-status-handler.ts',
	'services/intent-service/src/turn-status-client.ts',
	'services/intent-service/src/turn-supervision.ts',
	'services/platform-provisioner/components/intents/0003_turn_supervision.sql',
	'services/platform-provisioner/components/intents/0004_input_replacements.sql',
	'services/platform-provisioner/components/actor-runs/0004_execution_journal.sql',
	'services/platform-provisioner/src/catalog.ts',
	'services/platform-provisioner/components/intents/0002_input_admission.sql',
	'libs/aven-customer-contracts/src/catalog.ts',
	'services/aven-api/src/customers/work-dispatch.ts',
	'libs/aven-customer-runtime/src/admission.ts',
	'libs/aven-customer-contracts/src/grant.ts',
	'services/aven-api/src/customers/work-http.ts',
	'services/intent-service/src/work-guard.ts',
	'libs/aven-customer-runtime/src/work-guard.ts',
	'services/aven-api/src/customers/worker-placement.ts',
	'services/aven-api/src/customers/store.ts',
	'libs/aven-customer-contracts/src/worker-placement.ts',
	'libs/aven-customer-runtime/src/worker-placement.ts',
	'libs/aven-customer-runtime/src/work-client.ts',
	'libs/aven-customer-runtime/src/pools.ts',
	'services/intent-service/src/turn-outbox.ts',
	'services/intent-service/src/productivity.ts',
	'services/aven-api/src/customers/work-exchange.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/action-claim.ts',
	'libs/aven-chat-engine/src/input-admission.ts',
	'libs/aven-llm-client/src/input-decision.ts',
	'libs/aven-intents/src/admission.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-chat-engine/src/durable.ts',
	'libs/aven-chat-engine/src/journal.ts',
	'libs/aven-chat-engine/src/model.ts',
	'libs/aven-chat-engine/src/turn-payload.ts',
	'libs/aven-productivity/src/actor.ts',
	'deploy/e2e/live-dispatched-chat.ts',
	'deploy/e2e/task-service-fixture.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const engineDigest = await journalDigest(evidence.fingerprints)
let installedEngine = engineDigest
const save = () =>
	writeFile(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 })
const owner = randomUUID(),
	intentId = randomUUID()
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined,
	runner: SqlPlanRunner | undefined
let worker: IntentTurnWorker | undefined
let modelService: ReturnType<typeof Bun.serve> | undefined, serverModel: ModelStream
let releaseSlow = () => {},
	slowTurn = '',
	blockSlow = true
const slowGate = new Promise<void>((resolve) => {
	releaseSlow = resolve
})
let releaseLostEffect = () => {},
	loseEffectReply = true
const lostEffect = new Promise<void>((resolve) => {
	releaseLostEffect = resolve
})
let losePublicationFor = '',
	publicationSaved = false,
	releasePublication = () => {}
let failBeforePublicationFor = ''
let loseHistoryFor = '',
	historyHeld = false,
	releaseHistory = () => {}
const lostHistory = new Promise<void>((resolve) => {
	releaseHistory = resolve
})
let loseStudioFor = '',
	studioHeld = false,
	savedStudioInvocation = '',
	releaseStudio = () => {}
const lostStudio = new Promise<void>((resolve) => {
	releaseStudio = resolve
})
let loseStudioPublicationFor = '',
	studioPublicationHeld = false,
	releaseStudioPublication = () => {}
const lostStudioPublication = new Promise<void>((resolve) => {
	releaseStudioPublication = resolve
})
const caseInterruptions = new Map<
	string,
	{ name: string; held: boolean; release: () => void; gate: Promise<void> }
>()
let archiveAfterEffectFor = '',
	archiveEffectHeld = false,
	releaseArchiveEffect = () => {}
const archiveEffect = new Promise<void>((resolve) => {
	releaseArchiveEffect = resolve
})
let stopAfterEffectFor = '',
	stopEffectHeld = false,
	releaseStopEffect = () => {}
let uncertainStopFor = ''
const stopEffect = new Promise<void>((resolve) => {
	releaseStopEffect = resolve
})
const lostPublication = new Promise<void>((resolve) => {
	releasePublication = resolve
})
async function until<T>(
	action: () => Promise<T | undefined>,
	description: string,
	timeout = 180_000
): Promise<T> {
	const end = Date.now() + timeout
	while (Date.now() < end) {
		const value = await action()
		if (value !== undefined) return value
		await Bun.sleep(100)
	}
	throw Error(`Timed out: ${description}`)
}
const modelFor = (turnId: string): ModelStream =>
	async function* (messages, tools, signal, _model, options) {
		const effectiveOptions = {
			...options,
			max_tokens: options?.max_tokens ?? 2048,
			thinking: options?.thinking ?? false
		}
		if (tools.some((tool) => tool.name === 'studio_author')) {
			evidence.studioInputs ??= []
			if (!evidence.studioInputs.some((request: any) => request.turnId === turnId)) {
				// This entire journey uses independently invented data. Retain the first
				// actual request for repeatable tool-selection experiments, never customer prompts.
				evidence.studioInputs.push({ turnId, messages, tools, options: effectiveOptions })
				await save()
			}
		}
		if (turnId === slowTurn && blockSlow) await slowGate
		signal?.throwIfAborted()
		const timing = {
			turnId,
			phase: options?.phase,
			startedAt: new Date().toISOString(),
			elapsedMs: 0,
			status: 'running',
			events: [] as import('@avenos/chat-engine/model').StreamEvent[]
		}
		evidence.models.push(timing)
		const began = performance.now()
		try {
			for await (const event of serverModel(messages, tools, signal, undefined, effectiveOptions)) {
				timing.events.push(event)
				yield event
			}
			timing.status = 'completed'
		} catch (error) {
			timing.status = 'failed'
			throw error
		} finally {
			timing.elapsedMs = performance.now() - began
		}
	}
try {
	// Actual service-authenticated facade and streaming client, never a substitute model.
	const modelHandler = createFacadeHandler(
		gatewayConfig,
		new IdentityVerifier({ issuer: 'https://identity.example.test' }),
		undefined,
		undefined,
		undefined,
		undefined,
		gateway
	)
	modelService = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		idleTimeout: 255,
		fetch: (request) => modelHandler(request)
	})
	const modelClient = new HttpLlmGatewayClient({
		baseUrl: modelService.url.origin + '/internal/v1/llm',
		bearerToken: modelServiceToken
	})
	serverModel = createServerChatModel(modelClient, 'proof-qwen')
	const endpoint = modelService.url.origin + '/internal/v1/llm/v1/chat/completions'
	for (const headers of [
		{},
		{ authorization: 'Bearer wrong-service' },
		...[
			'origin',
			'cookie',
			'x-aven-identity-token',
			'x-aven-tenant-grant',
			'x-aven-work-grant'
		].map((name) => ({ authorization: 'Bearer ' + modelServiceToken, [name]: 'untrusted' }))
	] as Record<string, string>[]) {
		const response = await fetch(endpoint, { method: 'POST', headers, body: '{}' })
		assert.equal(response.status, 401)
		await response.body?.cancel()
	}
	for (const [body, status] of [
		['{', 400],
		['{}', 400],
		['x'.repeat(2 * 1024 * 1024 + 1), 413]
	] as const) {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { authorization: 'Bearer ' + modelServiceToken },
			body
		})
		assert.equal(response.status, status)
		await response.body?.cancel()
	}
	evidence.modelTransport =
		'Service-authenticated HTTP facade; bounded requests and mixed-authority rejection'
	fixture = await taskServiceFixture(database, owner, intentId, { artifacts: true })
	const f = fixture
	await f.placementClient.proof(f.environmentId, 1)
	await assert.rejects(() => f.placementClient.proof(f.environmentId, 2), /unavailable or changed/)
	await assert.rejects(() => f.placementClient.proof(randomUUID(), 1), /unavailable or changed/)
	const placementInput = {
		runtimeId: 'primary',
		componentRef: 'ceo.aven:component:data:intents@1',
		environmentId: f.environmentId
	}
	assert.equal(
		(await f.admission.placementRequest({ ...placementInput, after: randomUUID() })).status,
		400
	)
	for (const headers of [
		{ authorization: 'Bearer not-authorized' },
		{ origin: 'https://not-a-worker.example.test' }
	] as Record<string, string>[])
		assert.equal((await f.admission.placementRequest(placementInput, headers)).status, 403)
	await f.admission.control.query(
		"UPDATE customer_environments SET observed_state='suspended' WHERE id=$1",
		[f.environmentId]
	)
	try {
		await assert.rejects(
			() => f.placementClient.proof(f.environmentId, 1),
			/unavailable or changed/
		)
	} finally {
		await f.admission.control.query(
			"UPDATE customer_environments SET observed_state='ready' WHERE id=$1",
			[f.environmentId]
		)
	}
	evidence.exactPlacementLookup = {
		missingDenied: true,
		changedGenerationDenied: true,
		suspensionDenied: true,
		conflictingSelectionDenied: true,
		unauthorizedDenied: true
	}
	const artifacts = new StudioArtifacts(f.seedArtifacts!, f.environmentId)
	for (const name of ['orchard-tool-inventory', 'pottery-kiln-notes', 'canal-clearing-rota']) {
		await artifacts.publish({
			id: randomUUID(),
			procedure: 'test.independent-source',
			principal: owner,
			inputs: [],
			parameters: {},
			artifacts: [
				{
					key: 'source',
					type: 'core.file',
					payload: {
						originalName: `${name}.txt`,
						declaredMediaType: 'text/plain',
						sourceKind: 'synthetic-proof'
					},
					bytes: new TextEncoder().encode(`Fictional rehearsal document: ${name}.`),
					mediaType: 'text/plain'
				}
			]
		})
	}
	let checkedArtifactBoundary = false
	const artifactReaders = new Map<string, Awaited<ReturnType<typeof f.artifactReader>>>()
	const artifactPublishers = new Map<string, Awaited<ReturnType<typeof f.artifactPublisher>>>()
	const studioBindings = new Map<string, Awaited<ReturnType<typeof f.studioAuthoring>>>()
	let studioEnabled = false
	const studioInstallations = new TrustedActorInstallations()
	await installMarkdownRuntimeActor(studioInstallations)
	const studioCatalog = createDocumentCatalogSource(f.environmentId, studioInstallations, [
		createMarkdownRuntimeFactory(artifacts).offer
	])
	const chatHost = new ChatTurnHost({
		environmentId: f.environmentId,
		generation: 1,
		issuer: f.issuer,
		publicKey: f.tenantKey,
		lifecycle: f.lifecycleClient,
		client: (token, binding) =>
			f.turnClient(binding.turnId, binding.runId, binding.leaseOwnerId, token),
		journal: (lease) => new SqlChatJournal(f.workerPool, lease.runId, lease.ownerId, engineDigest),
		model: modelFor,
		priorActionsReady: (references) =>
			replacementActionsReady(
				f.workerPool,
				{
					environmentId: f.environmentId,
					routingGeneration: 1
				},
				references
			),
		priorActions: (references) =>
			readReplacementActions(
				f.workerPool,
				{
					environmentId: f.environmentId,
					routingGeneration: 1
				},
				references
			),
		context: () =>
			'Use the available task Actor when the accepted request calls for saved tasks. Do not infer tasks from a broad topic.',
		tools: async ({ accepted: loaded, binding, workToken }, lease, signal) => {
			const repository = f.delegatedRepository(
				binding.turnId,
				lease.runId,
				lease.ownerId,
				workToken
			)
			const artifactReader = await f.artifactReader(
				binding.turnId,
				lease.runId,
				lease.ownerId,
				workToken,
				signal
			)
			artifactReaders.set(binding.turnId, artifactReader)
			artifactPublishers.set(
				binding.turnId,
				await f.artifactPublisher(binding.turnId, lease.runId, lease.ownerId, workToken, signal)
			)
			if (!checkedArtifactBoundary) {
				await artifactReader.context()
				await assert.rejects(
					() => artifactReader.artifact(randomUUID(), randomUUID()),
					/same-workspace artifact reads/
				)
				await assert.rejects(
					() =>
						artifactReader.publish(f.environmentId, randomUUID(), randomUUID(), {
							intent: {},
							blobAuthorities: {}
						}),
					/same-workspace artifact reads/
				)
				checkedArtifactBoundary = true
			}
			const historyClient = await f.turnClient(
				binding.turnId,
				lease.runId,
				lease.ownerId,
				workToken
			)
			const template = createHistoryActor(historyClient),
				historyManifest = template.manifest
			template.dispose()
			const tools = createChatActorTools({
				assertActive: () => lease.assertActive(),
				context: (operationId) => ({
					operationId,
					signal,
					intentId: loaded.intentId,
					contributionId: loaded.contributionId
				}),
				actors: [
					...(studioEnabled
						? [
								await (async () => {
									const studio = await f.studioAuthoring(
										binding.turnId,
										lease.runId,
										lease.ownerId,
										workToken,
										runner!,
										studioInstallations,
										studioCatalog,
										signal
									)
									studioBindings.set(binding.turnId, studio)
									assert(
										!studio.manifest.methods.some((m) =>
											[
												'studio_start',
												'studio_sync',
												'studio_connect',
												'studio_case_confirm'
											].includes(m.name)
										)
									)
									return studio
								})()
							]
						: []),
					{ manifest: historyManifest, create: () => createHistoryActor(historyClient) },
					{
						manifest: KNOWLEDGE_MANIFEST,
						create: () =>
							createKnowledgeActor((query) =>
								artifactReader.library(
									f.environmentId,
									query as Record<string, string | number | undefined>
								)
							)
					},
					{
						manifest: TASK_MANIFEST,
						create: (invocation) =>
							createTaskActor(repository, () => ({
								ownerSubjectId: owner,
								operationId: invocation.operationId,
								intentId: loaded.intentId,
								contributionId: loaded.contributionId
							})),
						receipt: async (invocation) => {
							const receipt = await repository.receipt(owner, invocation.operationId)
							if (!receipt) return null
							const record = JSON.stringify({ ok: true, mode: 'production', ...receipt })
							return { record, wire: record }
						}
					}
				]
			})
			return {
				...tools,
				execute: async (name, args, operationId) => {
					const caseInterruption = caseInterruptions.get(binding.turnId)
					const interruptCase =
						caseInterruption && !caseInterruption.held && name === caseInterruption.name
					if (interruptCase) f.losePublicationAcknowledgement()
					const interruptPublication =
						!studioPublicationHeld &&
						binding.turnId === loseStudioPublicationFor &&
						name === 'studio_publish'
					if (interruptPublication) f.losePublicationAcknowledgement()
					const result = await tools.execute(name, args, operationId)
					if (interruptCase && result.outcome === 'uncertain') {
						caseInterruption.held = true
						await caseInterruption.gate
					}
					if (interruptPublication) {
						assert.equal(
							result.outcome,
							'uncertain',
							'A lost committed Store reply is never a confirmed failure.'
						)
						studioPublicationHeld = true
						await lostStudioPublication
					}
					if (loseEffectReply && binding.turnId === slowTurn && name === 'todo_create') {
						loseEffectReply = false
						await lostEffect
					}
					if (!historyHeld && binding.turnId === loseHistoryFor && name.startsWith('workspace_')) {
						historyHeld = true
						await lostHistory
					}
					if (
						!studioHeld &&
						binding.turnId === loseStudioFor &&
						name === 'studio_author' &&
						JSON.parse(result.record).saved
					) {
						savedStudioInvocation = operationId
						studioHeld = true
						await lostStudio
					}
					if (
						!archiveEffectHeld &&
						binding.turnId === archiveAfterEffectFor &&
						name === 'todo_create'
					) {
						archiveEffectHeld = true
						await archiveEffect
					}
					if (!stopEffectHeld && binding.turnId === stopAfterEffectFor && name === 'todo_create') {
						stopEffectHeld = true
						await stopEffect
					}
					if (binding.turnId === uncertainStopFor && name === 'todo_create')
						throw Error('Synthetic transport loss after the actual committed action.')
					return result
				}
			}
		}
	})
	const executor = createChatTurnExecutor({
		completion: (...args) => chatHost.completion(...args),
		open: async (...args) => {
			const session = await chatHost.open(...args)
			return {
				...session,
				publish: async (output) => {
					if (session.input.turnId === failBeforePublicationFor)
						throw Error(
							'Injected publication boundary outage after actual model and tool completion.'
						)
					const outputId = await session.publish(output)
					evidence.turns.push({
						input: session.input.user.content,
						turnId: session.input.turnId,
						...output,
						outputId
					})
					await save()
					if (session.input.turnId === losePublicationFor) {
						publicationSaved = true
						await lostPublication
					}
					return outputId
				}
			}
		}
	})
	const createRunner = () =>
		new SqlPlanRunner(
			f.actorPool,
			f.workerPool,
			executor,
			true,
			180_000,
			5,
			(record) => chatHost.ready(record),
			(record) => (record.skillRef === CHAT_TURN_SKILL ? installedEngine : undefined)
		)
	runner = createRunner()
	f.installRunner(() => runner!)
	const input = async (text: string, target: InputAdmission['target']): Promise<InputAdmission> => {
		// Real routing classifies scope; this journey explicitly confirms the target
		// just as the destination picker can. Never infer scope from a test keyword.
		const route = await gateway.inputDecision(
			{
				kind: 'route',
				modelId: 'proof-qwen',
				text,
				locale: 'en-GB',
				context: {
					selectedId: intentId,
					intents: [{ id: intentId, title: 'Community repair cafe' }],
					recent: []
				}
			},
			owner
		)
		evidence.routes.push({ text, ...route })
		await save()
		return {
			inputId: randomUUID(),
			revision: 1,
			text,
			originalText: text,
			corrections: [],
			target,
			locale: 'en-GB',
			timezone: 'Europe/London',
			capturedAt: new Date().toISOString(),
			decisionId: randomUUID(),
			responseMode: (route.decision as InputRoute).responseMode,
			confirmed: true,
			references: []
		}
	}
	const first = await f.admission.admit(
		await input(
			'Please save a task to label the seed trays and another to oil the wheelbarrow. Both in my list, no dates.',
			{ kind: 'existing', id: intentId }
		)
	)
	slowTurn = first.turnId
	const followup = await f.admission.admit(
		await input('the wheelbarrow is sorted. tick just that one off please', {
			kind: 'existing',
			id: intentId
		})
	)
	losePublicationFor = followup.turnId
	const separate = await f.admission.admit(
		await input(
			'I want to discuss the neighbourhood film evening. Not sure which question to ask yet.',
			{ kind: 'new', title: 'Neighbourhood cinema' }
		)
	)
	const visibleTurns = async (id: string) => {
		const response = await f.admission.request(`/${id}/turns`)
		assert.equal(response.status, 200)
		return turnPageSchema.parse(await response.json()).turns
	}
	assert.deepEqual(
		(await visibleTurns(intentId)).map((t) => [t.turnId, t.state]),
		[
			[followup.turnId, 'queued'],
			[first.turnId, 'queued']
		]
	)
	let loseAdmission = true
	const createDispatcher = (outbox = f.turns) =>
		new IntentTurnDispatcher(outbox, {
			admit: async (_scope, dispatch) => {
				const handle = await f.dispatchClient.admit(dispatch)
				if (loseAdmission && dispatch.turnId === first.turnId) {
					loseAdmission = false
					throw Error('Injected lost committed runner admission reply.')
				}
				return handle
			},
			// Deliberately no foreground wakeup: the real runner's periodic recovery owns it.
			wake: async () => {}
		})
	const discoveredPump = async () =>
		Promise.allSettled(
			(await f.discover()).map((item) => createDispatcher().dispatch(item.scope, item.turnId))
		)
	await assert.rejects(
		() => createDispatcher().dispatch(f.turnScope, first.turnId),
		/lost committed/
	)
	assert.equal(
		(await f.pool.query('SELECT state FROM aven_actor_runs.runs')).rows[0].state,
		'accepted'
	)
	assert.equal(evidence.models.length, 0)
	await runner.close()
	runner = createRunner()
	await runner.recoverAcceptedRuns()
	assert.equal(evidence.models.length, 0, 'Recovery cannot outrun outbox acknowledgement.')
	// Expire only this deliberately lost dispatch lease instead of waiting thirty seconds.
	await f.pool.query(
		`UPDATE aven_intents.turn_outbox SET dispatch_until=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
		[first.turnId]
	)
	const results = await discoveredPump()
	assert(results.every((result) => result.status === 'fulfilled'))
	await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === separate.turnId),
		'the independent topic completes'
	)
	assert(
		!evidence.turns.some(
			(turn: any) => turn.turnId === first.turnId || turn.turnId === followup.turnId
		)
	)
	assert.equal(
		evidence.turns[0].payload.toolCallCount ?? 0,
		0,
		'A broad topic should clarify, not inspect unrelated tasks.'
	)
	const waiting = (
		await f.pool.query(
			"SELECT record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1",
			[first.turnId]
		)
	).rows[0].record
	assert.equal(waiting.progress?.kind, 'intent-turn')
	assert.equal(
		waiting.progress?.operation.state,
		'running',
		'A delayed model is visibly working before it answers.'
	)
	assert.equal(waiting.progress?.operation.kind, 'model')
	assert.equal(waiting.progress?.operation.phase, 'answer')
	assert.deepEqual(
		(await visibleTurns(intentId)).map((t) => t.state),
		['queued', 'accepted']
	)
	assert.equal((await visibleTurns(separate.intentId))[0].state, 'completed')
	assert(waiting.progress?.operation.startedAt > 0)
	assert(
		!JSON.stringify(waiting.progress).includes('seed trays'),
		'Execution metadata must not copy prompts or tool arguments.'
	)
	const activeArtifactReader = artifactReaders.get(first.turnId)!
	const missing = await activeArtifactReader
		.artifact(f.environmentId, randomUUID())
		.catch((error) => error)
	assert.equal(missing.code, 'RESOURCE_UNAVAILABLE')
	assert.equal(missing.status, 404)
	assert.equal(missing.message, 'The requested artifact record was not found.')
	await f.admission.control.query(
		'DELETE FROM customer_environment_memberships WHERE environment_id=$1 AND subject_id=$2',
		[f.environmentId, owner]
	)
	try {
		await assert.rejects(
			() => activeArtifactReader.context(),
			/WORK_ACCESS_DENIED|ENVIRONMENT_NOT_FOUND|MEMBERSHIP_ACTION_DENIED/
		)
	} finally {
		await f.admission.control.query(
			`INSERT INTO customer_environment_memberships(environment_id,subject_id,role) VALUES($1,$2,'owner')`,
			[f.environmentId, owner]
		)
	}
	await f.pool.query(
		'UPDATE aven_platform.environment_identity SET execution_enabled=false WHERE singleton'
	)
	try {
		await assert.rejects(
			() => activeArtifactReader.context(),
			/WORK_EXECUTION_ENDED|WORK_CHECK_UNAVAILABLE/
		)
	} finally {
		await f.pool.query(
			'UPDATE aven_platform.environment_identity SET execution_enabled=true WHERE singleton'
		)
	}
	blockSlow = false
	releaseSlow()
	await until(
		async () => (!loseEffectReply ? true : undefined),
		'task save reaches the injected interruption',
		90_000
	)
	await runner.close()
	runner = createRunner()
	const interrupted = (
		await f.pool.query(
			"SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1",
			[first.turnId]
		)
	).rows[0]
	assert.equal(
		interrupted.record.state,
		'running',
		'A journaled shutdown keeps the original run recoverable.'
	)
	await f.pool.query(
		`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
		[interrupted.id]
	)
	const recovering = runner.recoverAcceptedRuns()
	await until(async () => {
		const record = (await runner!.status(interrupted.id))!
		return record.state === 'running' && record.lease?.ownerId !== interrupted.record.lease.ownerId
			? true
			: undefined
	}, 'replacement lease')
	releaseLostEffect()
	await recovering
	await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === first.turnId),
		'the delayed task request completes'
	)
	await discoveredPump()
	await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === followup.turnId),
		'queued follow-up uses the saved receipt'
	)
	await until(
		async () => (publicationSaved ? true : undefined),
		'saved publication acknowledgement is held'
	)
	const callsBeforePublicationRecovery = evidence.models.length
	await runner.close()
	runner = createRunner()
	const publishedRun = (
		await f.pool.query(
			"SELECT id FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1",
			[followup.turnId]
		)
	).rows[0].id
	await f.pool.query(
		`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
		[publishedRun]
	)
	await runner.recoverAcceptedRuns()
	releasePublication()
	assert.equal(
		evidence.models.length,
		callsBeforePublicationRecovery,
		'Committed publication recovery does not call Qwen again.'
	)
	const tasks = (await f.repository().list(owner, {})).tasks
	assert.equal(tasks.length, 2)
	assert.equal(tasks.filter((t) => t.status === 'done').length, 1)
	assert.match(tasks.find((t) => t.status === 'done')!.title, /wheelbarrow/i)
	assert.equal(
		Number((await f.pool.query('SELECT count(*) FROM aven_actor_runs.runs')).rows[0].count),
		3
	)
	assert.equal(
		Number(
			(await f.pool.query("SELECT count(*) FROM aven_intents.turn_outbox WHERE state='completed'"))
				.rows[0].count
		),
		3
	)
	const savedReply = evidence.turns.find((turn: any) => turn.turnId === first.turnId)
	const completedTurns = await visibleTurns(intentId)
	assert(
		completedTurns.every((t) => t.state === 'completed' && t.outputContributionId && t.finishedAt)
	)
	assert.equal(
		completedTurns.find((t) => t.turnId === first.turnId)?.outputContributionId,
		savedReply.contributionId ??
			(
				await f.pool.query('SELECT output_id FROM aven_intents.turn_outbox WHERE turn_id=$1', [
					first.turnId
				])
			).rows[0].output_id
	)
	assert.equal(
		savedReply.payload.toolCalls[0].durationBasis,
		'receipt-check',
		'A lost reply is resolved from its real saved receipt, not re-executed.'
	)
	assert.equal((await runner.status(interrupted.id))!.attemptCount, 2)
	await until(
		async () =>
			Number(
				(await f.pool.query("SELECT count(*) FROM aven_actor_runs.runs WHERE state='succeeded'"))
					.rows[0].count
			) === 3
				? true
				: undefined,
		'runner terminal receipts'
	)
	await assert.rejects(() => f.actorPool.query('SELECT * FROM run_steps'), /permission denied/)
	evidence.checks = {
		lostAdmission: true,
		restartBeforeExecution: true,
		independentIntent: true,
		sameIntentFIFO: true,
		lostWakeRecovery: true,
		lostEffectReplyRecovery: true,
		lostPublicationRecovery: true,
		oneEffectPerRequest: true,
		restrictedJournal: true,
		noLoginTokenForTools: true,
		modelProgressBeforeAnswer: true,
		signedWorkerDiscovery: true,
		publicQueueProjection: true
	}
	for (const scenario of [
		{
			text: 'Ich möchte mich mit dem Segelkurs beschäftigen. Noch keine konkrete Frage.',
			title: 'Segelkurs',
			tools: false
		},
		{
			text: 'uh new thing, balcony shade. dunno yet what I need help with',
			title: 'Balcony shade',
			tools: false
		},
		{
			text: 'Dans ce nouveau sujet, ajoute une tâche personnelle : vérifier le câble du projecteur. Pas de date.',
			title: 'Projection',
			tools: true
		}
	]) {
		const admittedInput = await input(scenario.text, { kind: 'new', title: scenario.title })
		assert.equal(admittedInput.responseMode, scenario.tools ? 'work' : 'clarify')
		const accepted = await f.admission.admit(admittedInput)
		await discoveredPump()
		const answer: any = await until(async () => {
			const result = evidence.turns.find((turn: any) => turn.turnId === accepted.turnId)
			if (result) return result
			const failed = (
				await f.pool.query(
					`SELECT record->'failure' AS failure FROM aven_actor_runs.runs
        WHERE record->'parameters'->>'turnId'=$1 AND state='failed'`,
					[accepted.turnId]
				)
			).rows[0]
			assert(!failed, `Varied turn failed before publication: ${JSON.stringify(failed?.failure)}`)
		}, 'varied new-topic reply')
		assert.equal(answer.state, 'completed')
		if (scenario.tools) {
			assert(
				answer.payload.toolCalls?.some(
					(call: any) => call.name === 'todo_create' && call.status === 'completed'
				)
			)
			assert.equal((await f.repository().list(owner, {})).tasks.length, 3)
		} else {
			assert.equal(
				answer.payload.toolCallCount ?? 0,
				0,
				'Opening a topic in another style or language is not authorization for a lookup.'
			)
			assert(answer.text.includes('?'), 'Ask for the desired result.')
			assert(answer.text.length < 650, 'Clarification must stay concise.')
		}
	}
	await until(
		async () =>
			Number(
				(await f.pool.query("SELECT count(*) FROM aven_actor_runs.runs WHERE state='succeeded'"))
					.rows[0].count
			) === 6
				? true
				: undefined,
		'all varied runs close'
	)
	// Independently invented archive, not copied or rephrased customer material.
	// Retrieval uses actual signed HTTP plus the same indexed Store as native chat.
	const archiveId = randomUUID(),
		mistakenId = randomUUID(),
		correctionId = randomUUID(),
		appendixId = randomUUID()
	await f.store.create(owner, {
		id: archiveId,
		title: 'Telescope lending rota',
		intentType: 'intent',
		sourceLabel: 'Synthetic rehearsal',
		deadline: null
	})
	await f.store.append(owner, archiveId, {
		id: mistakenId,
		contributorKind: 'agent',
		kind: 'message',
		text: 'For the telescope lending rota, the eyepiece cases belong in the blue cupboard.',
		payload: {}
	})
	await f.store.append(owner, archiveId, {
		id: correctionId,
		contributorKind: 'human',
		kind: 'message',
		text: 'Correction to the telescope lending rota: put the eyepiece cases in the amber locker, not the blue cupboard. This is the agreed final storage location.',
		payload: {}
	})
	await f.store.append(owner, archiveId, {
		id: randomUUID(),
		contributorKind: 'human',
		kind: 'response-feedback',
		text: null,
		payload: {
			responseId: mistakenId,
			vote: 'down',
			reason: 'The location was corrected later in this discussion.',
			previousFeedbackId: null
		}
	})
	const appendix =
		Array.from(
			{ length: 240 },
			(_, i) =>
				`Rota planning note ${i + 1}: the volunteer training session covered careful equipment handling and checking the cases on return.\n`
		).join('') +
		'\nSpare-key handover: give the spare key to the evening steward at the west desk. This supersedes the provisional reception-drawer idea.'
	await f.store.append(owner, archiveId, {
		id: appendixId,
		contributorKind: 'human',
		kind: 'message',
		text: appendix,
		payload: {}
	})
	const archived = await f.store.detail(owner, archiveId)
	await f.store.archiveOrRestore(
		owner,
		archiveId,
		{ id: archiveId, expectedVersion: archived.version },
		false
	)
	for (const scenario of [
		{
			text: 'Where did we finally agree to keep the eyepiece cases for the telescope lending rota? Look up the old discussion and answer here. Do not create tasks.',
			expected: /amber locker/i,
			source: correctionId,
			paged: false
		},
		{
			text: 'and the spare key handover for that rota? read the full planning notes if necessary, no tasks pls',
			expected: /evening steward[\s\S]*west desk|west desk[\s\S]*evening steward/i,
			source: appendixId,
			paged: true
		}
	]) {
		const accepted = await f.admission.admit(
			await input(scenario.text, { kind: 'existing', id: intentId })
		)
		if (!scenario.paged) loseHistoryFor = accepted.turnId
		await discoveredPump()
		if (!scenario.paged) {
			await until(
				async () => (historyHeld ? true : undefined),
				'hold actual history reply before checkpoint'
			)
			const prior = (
				await f.pool.query(
					`SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1`,
					[accepted.turnId]
				)
			).rows[0]
			await runner.close()
			runner = createRunner()
			await f.pool.query(
				`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
				[prior.id]
			)
			await runner.recoverAcceptedRuns()
			await until(
				async () =>
					(await runner!.status(prior.id))?.lease?.ownerId !== prior.record.lease.ownerId
						? true
						: undefined,
				'new owner for interrupted observation'
			)
			releaseHistory()
		}
		const answer: any = await until(
			async () => evidence.turns.find((turn: any) => turn.turnId === accepted.turnId),
			'archived history answer'
		)
		assert.equal(answer.state, 'completed')
		assert.match(answer.text, scenario.expected)
		const calls = answer.payload.toolCalls ?? []
		assert(
			!calls.some((c: any) => c.status === 'failed'),
			'The historical lookup must not require failed trial-and-error calls.'
		)
		if (!scenario.paged)
			assert(
				calls.some((c: any) => c.durationBasis === 'read-again'),
				'An interrupted observation is freshly read, not labelled as an old effect receipt.'
			)
		assert(
			calls.some(
				(c: any) =>
					['workspace_read', 'workspace_search'].includes(c.name) &&
					(JSON.parse(c.result ?? '{}').sourceId === scenario.source ||
						JSON.parse(c.result ?? '{}').messages?.some(
							(message: any) =>
								message.sourceId === scenario.source && Number.isSafeInteger(message.offset)
						) ||
						JSON.parse(c.result ?? '{}').conversation?.some(
							(message: any) => message.sourceId === scenario.source
						))
			),
			'Retrieve exact historical evidence under its message identity, not an unmarked search snippet.'
		)
		if (scenario.paged)
			assert(
				calls.some(
					(c: any) =>
						(c.name === 'workspace_read' && JSON.parse(c.arguments).offset > 0) ||
						(c.name === 'workspace_search' &&
							JSON.parse(c.result ?? '{}').messages?.some(
								(message: any) => message.sourceId === scenario.source && message.offset > 0
							))
				),
				'Retrieve exact text beyond the initial long-text window.'
			)
		assert(
			!calls.some((c: any) => c.name.startsWith('todo_')),
			'Read-only history questions do not authorize saved tasks.'
		)
		assert.equal((await f.repository().list(owner, {})).tasks.length, 3)
		const receipt = await f.store.admission(owner, accepted.inputId, accepted.revision)
		assert.equal(
			receipt.intentId,
			intentId,
			'Evidence retrieval must not move the accepted conversation.'
		)
	}
	evidence.checks.archivedHistory = {
		indexedRead: true,
		exactEvidence: true,
		correctedFact: true,
		longTextOffsetRead: true,
		sameDestination: true,
		interruptedObservationRecovered: true,
		noFailedToolCalls: true
	}
	const documentCount = await f.admission.admit(
		await input(
			'Wie viele Quelldokumente sind im Workspace erfasst? Nur die Anzahl der Dateien, keine Aufgaben anlegen.',
			{ kind: 'existing', id: intentId }
		)
	)
	await discoveredPump()
	const counted: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === documentCount.turnId),
		'delegated artifact query answer'
	)
	assert.equal(counted.state, 'completed')
	assert.match(counted.text, /\b3\b|drei/i)
	const knowledgeCalls = counted.payload.toolCalls ?? []
	assert(
		knowledgeCalls.some(
			(c: any) =>
				c.name === 'knowledge_query' &&
				c.status === 'completed' &&
				JSON.parse(c.arguments).view === 'summary'
		)
	)
	assert.equal(
		knowledgeCalls.filter((c: any) => c.name === 'knowledge_query').length,
		1,
		'A count-only question needs one aggregate query, not a document inventory.'
	)
	assert(
		[...counted.text.trim()].length <= 200,
		'A count-only answer should remain brief enough to speak.'
	)
	assert(!knowledgeCalls.some((c: any) => c.status === 'failed' || c.name.startsWith('todo_')))
	await assert.rejects(
		() => artifactReaders.get(documentCount.turnId)!.context(),
		/WORK_EXECUTION_ENDED|abort|ended/i
	)
	evidence.checks.delegatedArtifacts = {
		realStore: true,
		sharedKnowledgeActor: true,
		scopedReads: true,
		noPublications: true,
		membershipRevocation: true,
		workspacePause: true,
		sanitizedErrors: true,
		endedAuthorityRejected: true,
		exactSourceCount: true,
		noFailedToolCalls: true
	}
	// More than one sweep page may await an outbox binding. No fabricated model
	// replies: the ready request behind them still goes through actual Qwen.
	await runner.close()
	runner = createRunner()
	const blockedRuns: string[] = []
	for (let index = 0; index < 17; index++) {
		const accepted = await f.admission.admit(
			await input('I would like to discuss a community repair workshop. No specific request yet.', {
				kind: 'new',
				title: `Repair workshop ${index + 1}`
			})
		)
		const claim = await f.turns.claim(f.turnScope, accepted.turnId)
		assert.equal(claim.state, 'claimed')
		if (claim.state !== 'claimed') throw Error('Expected the disposable dispatch claim.')
		blockedRuns.push((await f.dispatchClient.admit(claim.dispatch)).runId)
		// Deliberately omit the outbox acknowledgement, modelling a lost dispatch reply.
	}
	const ready = await f.admission.admit(
		await input(
			'Quiero hablar sobre un pequeño huerto comunitario, pero aún no tengo una pregunta concreta.',
			{ kind: 'new', title: 'Huerto comunitario' }
		)
	)
	const readyClaim = await f.turns.claim(f.turnScope, ready.turnId)
	assert.equal(readyClaim.state, 'claimed')
	if (readyClaim.state !== 'claimed') throw Error('Expected ready dispatch claim.')
	const readyRun = await f.dispatchClient.admit(readyClaim.dispatch)
	await f.turns.dispatched(f.turnScope, ready.turnId, readyClaim.dispatch.token, readyRun.runId)
	// A fresh process gets no foreground wakeup and must scan beyond the blocked page.
	await runner.close()
	runner = createRunner()
	await runner.recoverAcceptedRuns()
	await runner.recoverAcceptedRuns()
	const readyAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === ready.turnId),
		'ready work behind blocked recovery page',
		30_000
	)
	assert.equal(readyAnswer.payload.toolCallCount ?? 0, 0)
	assert(readyAnswer.text.includes('?'))
	for (const id of blockedRuns) assert.equal((await runner.status(id))!.state, 'accepted')
	evidence.checks.blockedRecoveryPageDoesNotStarveReadyWork = true
	// No foreground pump: the owned supervisor discovers and dispatches this turn
	// past a complete page of genuinely unavailable customer databases.
	await f.unavailablePlacements(17)
	const sweeps: TurnSweep[] = []
	worker = f.turnWorker(
		(outbox) => createDispatcher(outbox),
		(sweep) => sweeps.push(sweep)
	)
	const firstSweep = worker.tick()
	assert.equal(worker.tick(), firstSweep, 'Overlapping wakeups share one scan.')
	const unavailable = await firstSweep
	assert.equal(unavailable.placements, 16)
	assert.equal(unavailable.failed, 16)
	const automatic = await f.admission.admit(
		await input(
			'Save a personal task to test the folding lantern before the outdoor reading evening. No deadline.',
			{ kind: 'new', title: 'Outdoor reading' }
		)
	)
	worker.start()
	const automaticAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === automatic.turnId),
		'automatic delivery after unavailable placements'
	)
	assert.equal(automaticAnswer.state, 'completed')
	assert(
		automaticAnswer.payload.toolCalls?.some(
			(call: any) => call.name === 'todo_create' && call.status === 'completed'
		)
	)
	assert.equal((await f.repository().list(owner, {})).tasks.length, 4)
	await worker.close()
	assert(sweeps.some((sweep) => sweep.dispatched > 0 && sweep.placements === 2))
	await assert.rejects(() => worker!.tick(), /closed/)
	const scansAtClose = sweeps.length
	await Bun.sleep(150)
	assert.equal(sweeps.length, scansAtClose, 'Shutdown owns and removes its polling timer.')
	evidence.workerSweeps = sweeps
	evidence.checks.supervisedDelivery = true
	evidence.checks.unavailablePlacementPageDoesNotStarveReadyWork = true
	evidence.checks.workerShutdown = true
	evidence.diagnostics = (
		await f.pool.query(`SELECT r.record->'parameters'->>'turnId' AS "turnId",s.value->'result'->'diagnostics' AS diagnostics
    FROM aven_actor_runs.run_steps s JOIN aven_actor_runs.runs r ON r.id=s.run_id WHERE s.kind='outcome'`)
	).rows
	evidence.modelTimings = (
		await f.pool.query(`SELECT r.record->'parameters'->>'turnId' AS "turnId",s.ordinal,s.value->>'phase' AS phase,s.value->'timing' AS timing
    FROM aven_actor_runs.run_steps s JOIN aven_actor_runs.runs r ON r.id=s.run_id WHERE s.kind='model' AND s.state='complete'`)
	).rows
	assert(evidence.modelTimings.length > 0)
	for (const step of evidence.modelTimings) {
		assert(['answer', 'verification', 'repair', 'checklist'].includes(step.phase))
		assert(step.timing.durationMs > 0)
		assert(step.timing.firstContentMs > 0 && step.timing.firstContentMs <= step.timing.durationMs)
	}
	evidence.checks.modelFirstContentTiming = true
	// Inject expired-run snapshots around records produced above by actual Qwen.
	// These negative checks must stop before either the executor or model is called.
	const callsBeforeGuards = evidence.models.length
	for (const [turnId, guard] of [
		[first.turnId, 'changed-engine'],
		[followup.turnId, 'attempt-limit'],
		[separate.turnId, 'unregistered-executor']
	] as const) {
		const row = (
			await f.pool.query(
				"SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1",
				[turnId]
			)
		).rows[0]
		const record = {
			...row.record,
			state: 'running',
			attemptCount: guard === 'attempt-limit' ? 3 : 1,
			lease: { ownerId: randomUUID(), expiresAt: '2000-01-01T00:00:00Z' },
			...(guard === 'unregistered-executor' && { skillRef: 'ceo.aven:skill:proof:not-journaled@1' })
		}
		installedEngine = guard === 'changed-engine' ? 'd'.repeat(64) : engineDigest
		await f.pool.query("UPDATE aven_actor_runs.runs SET state='running',record=$2 WHERE id=$1", [
			row.id,
			record
		])
		await runner.recoverAcceptedRuns()
		assert.equal((await runner.status(row.id))!.failure?.code, 'EXECUTION_UNCERTAIN')
	}
	assert.equal(evidence.models.length, callsBeforeGuards)
	evidence.checks.recoveryGuards = ['changed-engine', 'attempt-limit', 'unregistered-executor']
	// A real model saves a task, but the answer cannot be committed. A terminal
	// runner must not masquerade as ongoing work or invite a duplicate tool action.
	const failedTurn = await f.admission.admit(
		await input('Please save a task to check the museum loan crate seals. No date.', {
			kind: 'new',
			title: 'Museum loans'
		})
	)
	failBeforePublicationFor = failedTurn.turnId
	await createDispatcher().dispatch(f.turnScope, failedTurn.turnId)
	const stopped: any = await until(
		async () =>
			(
				await f.pool.query(
					`SELECT id,record FROM aven_actor_runs.runs
    WHERE record->'parameters'->>'turnId'=$1 AND state='failed'`,
					[failedTurn.turnId]
				)
			).rows[0],
		'failed publication after a genuine task'
	)
	assert.equal((await f.repository().list(owner, {})).tasks.length, 5)
	const reference = {
		...chatTurnParameters.parse(stopped.record.parameters),
		subjectId: owner,
		runId: stopped.id
	}
	await until(
		async () =>
			(await f.statusClient.inspect(reference)).settlement === 'settled' ? true : undefined,
		'completed executor clears its movement fence'
	)
	assert.deepEqual(await f.statusClient.inspect(reference), {
		state: 'failed',
		uncertain: false,
		settlement: 'settled'
	})
	await assert.rejects(() => runner!.retry(stopped.id, randomUUID()), /generic retry cannot renew/)
	const firstPlacements = await f.placementClient.page()
	const placement = [
		...firstPlacements.placements,
		...(firstPlacements.next ? (await f.placementClient.page(firstPlacements.next)).placements : [])
	].find((p) => p.environmentId === f.environmentId)!
	assert(placement)
	await assert.rejects(
		() => f.actorPool.query('SELECT value FROM run_steps LIMIT 1'),
		/permission denied/,
		'The API role must not gain private journal access for settlement.'
	)
	const statusProof = (await f.actorPlacementClient.proofs()).placements[0]!.token
	const statusRequest = (body: unknown, changes: Record<string, string> = {}) =>
		fetch(f.runnerServiceUrl + '/internal/v1/work/turn/status', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${f.runnerToken}`,
				'x-aven-worker-placement': statusProof,
				'content-type': 'application/json',
				...changes
			},
			body: JSON.stringify(body)
		})
	for (const fields of [
		{ runId: randomUUID() },
		{ subjectId: randomUUID() },
		{ turnId: randomUUID() },
		{ inputId: randomUUID() },
		{ inputRevision: reference.inputRevision + 1 },
		{ materialDigest: 'f'.repeat(64) }
	])
		assert.equal((await statusRequest({ ...reference, ...fields })).status, 409)
	for (const headers of [
		{ authorization: 'Bearer wrong' },
		{ 'x-aven-worker-placement': 'invalid' },
		...[
			'cookie',
			'origin',
			'x-aven-identity-token',
			'x-aven-tenant-grant',
			'x-aven-work-grant'
		].map((name) => ({ [name]: 'untrusted' }))
	])
		assert.equal((await statusRequest(reference, headers)).status, 403)
	assert.equal((await statusRequest({ ...reference, prompt: 'untrusted' })).status, 400)
	assert.equal((await statusRequest({ ...reference, extra: 'x'.repeat(2049) })).status, 413)
	const beforeBlock = evidence.models.length
	const supervisionSweeps: TurnSweep[] = []
	worker = f.turnWorker(
		(outbox) => createDispatcher(outbox),
		(sweep) => supervisionSweeps.push(sweep),
		'supervise'
	)
	await worker.tick() // unavailable directory page cannot prevent the next page
	const supervision = await worker.tick()
	assert.equal(supervision.blocked, 1)
	await worker.close()
	evidence.supervisionSweeps = supervisionSweeps
	const block = (
		await f.pool.query('SELECT state,error_code FROM aven_intents.turn_outbox WHERE turn_id=$1', [
			failedTurn.turnId
		])
	).rows[0]
	assert.deepEqual(block, { state: 'blocked', error_code: 'RUN_FAILED' })
	await runner.recoverAcceptedRuns()
	assert.equal(
		evidence.models.length,
		beforeBlock,
		'Supervision must not repeat tools or model work.'
	)
	assert.equal((await f.repository().list(owner, {})).tasks.length, 5)
	assert(!(await f.turns.pending(f.turnScope)).includes(failedTurn.turnId))
	// The same real receipt is used for adverse coordination cases. Inject state
	// only, never model replies. Completed answers and uncertain effects remain
	// distinct; failure to contact the runner must not manufacture a terminal state.
	for (const [state, code, reason] of [
		['failed', 'EXECUTION_UNCERTAIN', 'EXECUTION_UNCERTAIN'],
		['cancelled', null, 'RUN_CANCELLED'],
		['succeeded', null, 'ANSWER_NOT_SAVED']
	] as const) {
		await f.pool.query(
			`UPDATE aven_intents.turn_outbox SET state='dispatched',error_code=NULL,available_at=clock_timestamp() WHERE turn_id=$1`,
			[failedTurn.turnId]
		)
		await f.pool.query(
			`UPDATE aven_actor_runs.runs SET state=$2,record=jsonb_set(record,'{failure}', $3::jsonb) WHERE id=$1`,
			[
				stopped.id,
				state,
				JSON.stringify({
					code,
					message: 'Synthetic private error; must not leave the status boundary.'
				})
			]
		)
		assert.equal((await superviseTurns(f.turns, placement, f.statusClient)).blocked, 1)
		assert.equal(
			(
				await f.pool.query('SELECT error_code FROM aven_intents.turn_outbox WHERE turn_id=$1', [
					failedTurn.turnId
				])
			).rows[0].error_code,
			reason
		)
	}
	await f.pool.query(
		`UPDATE aven_intents.turn_outbox SET state='dispatched',available_at=clock_timestamp() WHERE turn_id=$1`,
		[failedTurn.turnId]
	)
	await f.pool.query(
		`UPDATE aven_actor_runs.runs SET state='running',record=jsonb_set(record,'{lease}',
    jsonb_build_object('ownerId',$2::text,'expiresAt',clock_timestamp()+interval '5 minutes')) WHERE id=$1`,
		[stopped.id, randomUUID()]
	)
	await f.admission.control.query(
		`UPDATE customer_environment_components SET observed_state='suspended'
    WHERE environment_id=$1 AND component_ref='os.aven:component:actors:run-repository@1'`,
		[f.environmentId]
	)
	const unavailableCheck = await superviseTurns(f.turns, placement, f.statusClient)
	assert.equal(unavailableCheck.blocked, 0)
	assert.equal(unavailableCheck.unavailable, 1)
	assert.equal(
		(
			await f.pool.query('SELECT state FROM aven_intents.turn_outbox WHERE turn_id=$1', [
				failedTurn.turnId
			])
		).rows[0].state,
		'dispatched'
	)
	await f.admission.control.query(
		`UPDATE customer_environment_components SET observed_state='ready'
    WHERE environment_id=$1 AND component_ref='os.aven:component:actors:run-repository@1'`,
		[f.environmentId]
	)
	await f.pool.query(
		`UPDATE aven_intents.turn_outbox SET available_at=clock_timestamp() WHERE turn_id=$1`,
		[failedTurn.turnId]
	)
	const activeCheck = await superviseTurns(f.turns, placement, f.statusClient)
	assert.equal(activeCheck.blocked, 0)
	assert.equal(activeCheck.unavailable, 0)
	assert.equal(
		(await f.turns.statusChecksForWorker(placement)).length,
		0,
		'Active runs wait their next due time; scans cannot hammer the service.'
	)
	await f.pool.query(
		`UPDATE aven_intents.turn_outbox SET available_at=clock_timestamp(),authority_expires_at=clock_timestamp()-interval '1 second' WHERE turn_id=$1`,
		[failedTurn.turnId]
	)
	assert.equal((await superviseTurns(f.turns, placement, f.statusClient)).blocked, 1)
	assert.equal(
		(
			await f.pool.query('SELECT error_code FROM aven_intents.turn_outbox WHERE turn_id=$1', [
				failedTurn.turnId
			])
		).rows[0].error_code,
		'WORK_AUTHORITY_EXPIRED'
	)
	evidence.checks.terminalSupervision = {
		exactReference: true,
		mixedAuthorityRejected: true,
		boundedPolling: true,
		noDuplicateTaskAfterUnpublishedAnswer: true,
		unavailableIsNotFailed: true,
		failure: true,
		uncertain: true,
		cancellation: true,
		missingAnswer: true,
		expiry: true
	}
	// An accepted but unbound run must retire if its owning turn ends. It must not
	// remain an immortal recovery candidate or execute after a delayed admission.
	const orphan = (
		await f.pool.query(
			`SELECT t.intent_id,t.turn_id FROM aven_intents.turn_outbox t
    JOIN aven_actor_runs.runs r ON r.record->'parameters'->>'turnId'=t.turn_id::text WHERE r.id=$1`,
			[blockedRuns[0]]
		)
	).rows[0]
	const orphanIntent = await f.store.detail(owner, orphan.intent_id)
	await f.store.archiveOrRestore(
		owner,
		orphanIntent.id,
		{ id: orphanIntent.id, expectedVersion: orphanIntent.version },
		false
	)
	const beforeOrphan = evidence.models.length
	await until(async () => {
		await runner!.recoverAcceptedRuns()
		return (await runner!.status(blockedRuns[0]!))?.state === 'cancelled' ? true : undefined
	}, 'retire ended unbound admission')
	assert.equal(evidence.models.length, beforeOrphan)
	assert.equal(
		(
			await f.pool.query('SELECT state FROM aven_intents.turn_outbox WHERE turn_id=$1', [
				orphan.turn_id
			])
		).rows[0].state,
		'cancelled'
	)

	const archivedWork = await f.admission.admit(
		await input('Save one task to repaint the prop cupboard. No due date.', {
			kind: 'new',
			title: 'Puppet stage upkeep'
		})
	)
	archiveAfterEffectFor = archivedWork.turnId
	const archiveClaim = await f.turns.claim(f.turnScope, archivedWork.turnId)
	assert.equal(archiveClaim.state, 'claimed')
	if (archiveClaim.state !== 'claimed') throw Error('Expected archival scenario dispatch.')
	const archiveRun = await f.dispatchClient.admit(archiveClaim.dispatch)
	await f.turns.dispatched(
		f.turnScope,
		archivedWork.turnId,
		archiveClaim.dispatch.token,
		archiveRun.runId
	)
	await until(
		async () => (archiveEffectHeld ? true : undefined),
		'hold saved task acknowledgement during archival'
	)
	const beforeArchive = evidence.models.length
	const taskCountBeforeArchive = (await f.repository().list(owner, {})).tasks.length
	assert.equal(taskCountBeforeArchive, 6)
	const toArchive = await f.store.detail(owner, archivedWork.intentId)
	await f.store.archiveOrRestore(
		owner,
		toArchive.id,
		{ id: toArchive.id, expectedVersion: toArchive.version },
		false
	)
	const toRestore = await f.store.detail(owner, toArchive.id)
	await f.store.archiveOrRestore(
		owner,
		toRestore.id,
		{ id: toRestore.id, expectedVersion: toRestore.version },
		true
	)
	const afterRestore = await f.admission.admit(
		await input('Now mark the prop cupboard task as complete.', {
			kind: 'existing',
			id: toRestore.id
		})
	)
	assert.equal((await f.turns.claim(f.turnScope, afterRestore.turnId)).state, 'waiting')
	await assert.rejects(
		() => artifactReaders.get(archivedWork.turnId)!.context(),
		/WORK_EXECUTION_ENDED/
	)
	releaseArchiveEffect()
	await until(
		async () => ((await runner!.status(archiveRun.runId))?.state === 'failed' ? true : undefined),
		'revoked turn stops after the already saved task'
	)
	assert.equal(
		evidence.models.length,
		beforeArchive,
		'Revoked turns must not start another model request after a tool settles.'
	)
	assert.equal((await f.turns.claim(f.turnScope, afterRestore.turnId)).state, 'waiting')
	assert.equal((await f.repository().list(owner, {})).tasks.length, taskCountBeforeArchive)
	assert.equal(
		(await visibleTurns(toRestore.id)).find((t) => t.turnId === archivedWork.turnId)?.reason,
		'INTENT_UNAVAILABLE'
	)
	assert(
		!evidence.turns.some(
			(turn: any) => turn.turnId === archivedWork.turnId || turn.turnId === afterRestore.turnId
		)
	)
	evidence.checks.archivalFence = {
		realSavedEffect: true,
		noDuplicate: true,
		noNextModel: true,
		restoredIntentStillHoldsFIFO: true,
		endedAdmissionRetired: true
	}
	const stopTurn = async (
		receipt: { intentId: string; turnId: string },
		command = { commandId: randomUUID(), expectedControlRevision: 1 }
	) => {
		const response = await f.admission.request(
			`/${receipt.intentId}/turns/${receipt.turnId}/stop`,
			command
		)
		assert.equal(response.status, 200, await response.clone().text())
		return turnStopReceiptSchema.parse(await response.json())
	}
	const abandoned = await f.admission.admit(
		await input('Create a task to sort the costume ribbons.', {
			kind: 'new',
			title: 'Costume workshop'
		})
	)
	const stopCommand = { commandId: randomUUID(), expectedControlRevision: 1 }
	const beforeQueuedStop = evidence.models.length
	const stoppedReceipt = await stopTurn(abandoned, stopCommand)
	assert.equal(stoppedReceipt.disposition, 'cancelled')
	assert.deepEqual(await stopTurn(abandoned, stopCommand), stoppedReceipt)
	assert.equal((await f.turns.claim(f.turnScope, abandoned.turnId)).state, 'cancelled')
	assert.equal(evidence.models.length, beforeQueuedStop)
	assert.equal(
		(
			await f.admission.request(
				`/${abandoned.intentId}/turns/${abandoned.turnId}/stop`,
				stopCommand,
				randomUUID()
			)
		).status,
		404
	)
	assert.equal(
		(
			await f.admission.request(`/${abandoned.intentId}/turns/${abandoned.turnId}/stop`, {
				...stopCommand,
				target: 'other'
			})
		).status,
		400
	)
	assert.equal(
		(
			await f.admission.request(
				`/${abandoned.intentId}/turns/${abandoned.turnId}/stop?force=true`,
				stopCommand
			)
		).status,
		400
	)
	const stopWork = await f.admission.admit(
		await input('Save one task: sharpen the lino carving tools. No deadline.', {
			kind: 'existing',
			id: abandoned.intentId
		})
	)
	stopAfterEffectFor = stopWork.turnId
	const stopClaim = await f.turns.claim(f.turnScope, stopWork.turnId)
	assert.equal(
		stopClaim.state,
		'claimed',
		'Cancelling the earlier queued message releases its FIFO position.'
	)
	if (stopClaim.state !== 'claimed') throw Error('Expected stop scenario dispatch.')
	const stopRun = await f.dispatchClient.admit(stopClaim.dispatch)
	await f.turns.dispatched(f.turnScope, stopWork.turnId, stopClaim.dispatch.token, stopRun.runId)
	await until(async () => (stopEffectHeld ? true : undefined), 'actual task saved before stop')
	const beforeBoundStop = evidence.models.length,
		tasksBeforeStop = (await f.repository().list(owner, {})).tasks.length
	assert.equal(tasksBeforeStop, 7)
	// This is a host-transport boundary probe during actual Qwen-owned work, not a
	// claim that the full Studio tool or its child execution is installed in Chat.
	const artifactPublisher = artifactPublishers.get(stopWork.turnId)!
	const publishing = new StudioArtifacts(artifactPublisher, f.environmentId)
	const publicationEpoch = String((await publishing.context()).storeEpoch)
	const body = new TextEncoder().encode(
		'# Guarded publication\n\nA synthetic boundary rehearsal.\n'
	)
	const publication = {
		id: randomUUID(),
		procedure: 'artifacts.markdown.write',
		principal: owner,
		epoch: publicationEpoch,
		inputs: [],
		parameters: { turnId: stopWork.turnId, purpose: 'Synthetic publication transport probe' },
		artifacts: [
			{
				key: 'document',
				type: 'core.file',
				payload: {
					originalName: 'guarded-note.md',
					declaredMediaType: 'text/markdown; charset=utf-8',
					sourceKind: 'actor-authored',
					executionEnvironment: 'server'
				},
				bytes: body,
				mediaType: 'text/markdown; charset=utf-8'
			}
		]
	}
	f.losePublicationAcknowledgement()
	await assert.rejects(
		() => publishing.publish(publication),
		(error: any) => error.outcome === 'uncertain',
		'A lost acknowledgement of an actual commit is not a failed publication.'
	)
	const [publishedNote] = (await publishing.lookup(publication.id)) ?? []
	assert(publishedNote)
	assert.deepEqual(
		await publishing.publish(publication),
		[publishedNote],
		'Same publication and bytes replay exactly.'
	)
	assert.deepEqual(await artifactPublisher.content(f.environmentId, publishedNote.artifactId), body)
	assert.deepEqual(
		await publishing.lookup(publication.id),
		[publishedNote],
		'Lost acknowledgements are recoverable by original publication identity.'
	)
	await assert.rejects(() =>
		publishing.publish({
			...publication,
			parameters: { ...publication.parameters, purpose: 'Changed command' }
		})
	)
	await assert.rejects(
		() =>
			publishing.publish({
				...publication,
				id: randomUUID(),
				principal: randomUUID(),
				artifacts: []
			}),
		/admitted user/
	)
	await assert.rejects(
		() =>
			artifactPublisher.upload(
				randomUUID(),
				randomUUID(),
				{
					sha256: createHash('sha256').update(body).digest('hex'),
					length: body.length,
					declaredMediaType: 'text/plain'
				},
				body
			),
		/same-workspace/
	)
	assert.equal((await stopTurn(stopWork)).disposition, 'stopping')
	const stoppedState = (await visibleTurns(abandoned.intentId)).find(
		(t) => t.turnId === stopWork.turnId
	)!
	assert.equal(stoppedState.state, 'stopping')
	assert.equal(stoppedState.reason, 'USER_STOP_REQUESTED')
	assert.equal(stoppedState.finishedAt, null, 'A delayed effect is not labelled settled.')
	const stopReference = {
		...chatTurnParameters.parse((await runner!.status(stopRun.runId))!.parameters),
		subjectId: owner,
		runId: stopRun.runId
	}
	const followingStop = await f.admission.admit(
		await input('How many tasks are on this workshop list? Do not change anything.', {
			kind: 'existing',
			id: abandoned.intentId
		})
	)
	assert.equal((await f.statusClient.inspect(stopReference)).settlement, 'pending')
	await assert.rejects(
		() => readSettledChatReceipts(f.workerPool, placement, stopReference),
		/not available as settled evidence/
	)
	await superviseTurns(f.turns, placement, f.statusClient)
	assert.equal((await f.turns.claim(f.turnScope, followingStop.turnId)).state, 'waiting')
	await assert.rejects(
		() => artifactReaders.get(stopWork.turnId)!.context(),
		/WORK_EXECUTION_ENDED/
	)
	await assert.rejects(
		() =>
			artifactPublisher.upload(
				f.environmentId,
				randomUUID(),
				{
					sha256: createHash('sha256').update(body).digest('hex'),
					length: body.length,
					declaredMediaType: 'text/plain'
				},
				body
			),
		/WORK_EXECUTION_ENDED/
	)
	evidence.checks.workPublication = {
		actualStoreBytes: true,
		immutableReplay: true,
		originalReceipt: true,
		lostAcknowledgement: true,
		changedMaterialRejected: true,
		principalBound: true,
		crossScopeRejected: true,
		withdrawnWriteDenied: true,
		fullStudioToolHost: false
	}
	releaseStopEffect()
	await until(
		async () => ((await runner!.status(stopRun.runId))?.state === 'failed' ? true : undefined),
		'worker stops after retained task acknowledgement'
	)
	assert.equal(evidence.models.length, beforeBoundStop)
	assert.equal((await f.repository().list(owner, {})).tasks.length, tasksBeforeStop)
	assert(!evidence.turns.some((turn: any) => turn.turnId === stopWork.turnId))
	await until(
		async () =>
			(await f.statusClient.inspect(stopReference)).settlement === 'settled' ? true : undefined,
		'recorded tool outcome and stopped executor'
	)
	await f.pool.query(
		`UPDATE aven_intents.turn_outbox SET available_at=clock_timestamp() WHERE turn_id=$1`,
		[stopWork.turnId]
	)
	await superviseTurns(f.turns, placement, f.statusClient)
	const settledStop = (await visibleTurns(abandoned.intentId)).find(
		(t) => t.turnId === stopWork.turnId
	)!
	assert.equal(settledStop.state, 'cancelled')
	assert(settledStop.finishedAt)
	assert.equal(
		settledStop.outputContributionId,
		null,
		'Settlement is not an invented model answer.'
	)
	assert.equal(
		(await f.store.detail(owner, abandoned.intentId)).contributions.filter(
			(c) => c.kind === 'turn-stop-settled'
		).length,
		1
	)
	assert.equal(await f.turns.settleStopForWorker(placement, stopReference, 'settled'), false)
	const retainedActions = await readSettledChatReceipts(f.workerPool, placement, stopReference)
	const savedTask = retainedActions.find((receipt) => receipt.command.name === 'todo_create')
	assert(savedTask, 'The stopped turn must retain the actual task command and result')
	assert.equal(JSON.parse(savedTask.result.record).ok, true)
	assert.match(savedTask.command.args, /sharpen the lino carving tools/i)
	assert.deepEqual(
		await readSettledChatReceipts(f.workerPool, placement, stopReference),
		retainedActions
	)
	const transferred = await readReplacementActions(f.workerPool, placement, [stopReference])
	assert.equal(transferred.length, retainedActions.length)
	assert.deepEqual(
		transferred.map((value) => [value.invocationId, value.arguments, value.result]),
		retainedActions.map((value) => [value.invocationId, value.command.args, value.result.record])
	)
	await assert.rejects(
		() => readReplacementActions(f.workerPool, placement, [stopReference, stopReference]),
		/Invalid replacement ancestry/
	)
	for (const changed of [
		{ ...stopReference, subjectId: randomUUID() },
		{ ...stopReference, inputId: randomUUID() },
		{ ...stopReference, materialDigest: '0'.repeat(64) }
	])
		await assert.rejects(
			() => readSettledChatReceipts(f.workerPool, placement, changed),
			/not available as settled evidence/
		)
	for (const changed of [
		{ ...stopReference, subjectId: randomUUID() },
		{ ...stopReference, inputRevision: stopReference.inputRevision + 1 }
	])
		await assert.rejects(
			() =>
				readReplacementActions(f.workerPool, placement, [
					stopReference,
					{ ...changed, turnId: randomUUID() }
				]),
			/not available as settled evidence/,
			'A later invalid ancestor must reject the whole transfer, not return earlier receipts.'
		)
	await assert.rejects(
		() =>
			readSettledChatReceipts(
				f.workerPool,
				{ ...placement, routingGeneration: placement.routingGeneration + 1 },
				stopReference
			),
		/not available as settled evidence/
	)
	await assert.rejects(
		() => readSettledChatReceipts(f.actorPool, placement, stopReference),
		/permission denied/,
		'The API role must not gain access to private execution receipts'
	)
	evidence.checks.stoppedActionReceipts = {
		retainedActions,
		exactReference: true,
		workerOnly: true
	}
	assert.equal(
		(await f.turns.claim(f.turnScope, followingStop.turnId)).state,
		'claimed',
		'Known settled stop frees the next contribution.'
	)

	// A real saved mutation with a lost acknowledgement must not be treated as a
	// settled stop. No fabricated tool result is inserted in the journal.
	const uncertainStop = await f.admission.admit(
		await input('Save a task to label the spare loom shuttles. No deadline.', {
			kind: 'new',
			title: 'Weaving cupboard'
		})
	)
	uncertainStopFor = uncertainStop.turnId
	const uncertainClaim = await f.turns.claim(f.turnScope, uncertainStop.turnId)
	if (uncertainClaim.state !== 'claimed') throw Error('Expected uncertain stop dispatch.')
	const uncertainRun = await f.dispatchClient.admit(uncertainClaim.dispatch)
	await f.turns.dispatched(
		f.turnScope,
		uncertainStop.turnId,
		uncertainClaim.dispatch.token,
		uncertainRun.runId
	)
	await until(
		async () => ((await runner!.status(uncertainRun.runId))?.state === 'failed' ? true : undefined),
		'actual tool acknowledgement lost'
	)
	const uncertainReference = {
		...chatTurnParameters.parse((await runner!.status(uncertainRun.runId))!.parameters),
		subjectId: owner,
		runId: uncertainRun.runId
	}
	await until(
		async () =>
			(await f.statusClient.inspect(uncertainReference)).settlement === 'uncertain'
				? true
				: undefined,
		'missing tool receipt remains uncertain after executor settles'
	)
	assert.equal((await f.repository().list(owner, {})).tasks.length, tasksBeforeStop + 1)
	const uncertainNext = await f.admission.admit(
		await input('Now look at the weaving tasks.', { kind: 'existing', id: uncertainStop.intentId })
	)
	await stopTurn(uncertainStop)
	const beforeUncertainCheck = evidence.models.length
	await superviseTurns(f.turns, placement, f.statusClient)
	const uncertainVisible = (await visibleTurns(uncertainStop.intentId)).find(
		(t) => t.turnId === uncertainStop.turnId
	)!
	assert.equal(uncertainVisible.reason, 'EXECUTION_UNCERTAIN')
	await assert.rejects(
		() => readSettledChatReceipts(f.workerPool, placement, uncertainReference),
		/not available as settled evidence/
	)
	assert.equal(uncertainVisible.finishedAt, null)
	assert.equal((await f.turns.claim(f.turnScope, uncertainNext.turnId)).state, 'waiting')
	assert.equal(
		await f.turns.settleStopForWorker(placement, uncertainReference, 'settled'),
		false,
		'An uncertainty warning requires reconciliation, not a later generic status.'
	)
	assert.equal(evidence.models.length, beforeUncertainCheck)
	evidence.checks.stopControl = {
		queuedNoEffect: true,
		acknowledgementReplay: true,
		targetBound: true,
		closedRequest: true,
		boundWorkWithdrawn: true,
		savedActionRetained: true,
		noNextModel: true,
		settlementNotAssumed: true,
		settledRelease: true,
		settlementReceipt: true,
		uncertainEffectHeld: true
	}
	studioEnabled = true
	const tasksBeforeStudio = (await f.repository().list(owner, {})).tasks.length
	// One installed Studio Actor and real SQL/Store boundaries; Qwen chooses the
	// authoring calls. Source execution is deliberately not offered by this host.
	const authored = await f.admission.admit(
		await input(
			'We have been writing a short opening note manually before each workshop. Turn this into a reusable Skill named "Workshop opening note": write a Markdown document, with its title and content editable when running it. Save the draft, check it, and publish it. Do not run it or create tasks. You may discover the available operations.',
			{ kind: 'new', title: 'Reusable workshop notes' }
		)
	)
	await createDispatcher().dispatch(f.turnScope, authored.turnId)
	const authoredAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === authored.turnId),
		'real-model Studio authoring',
		240_000
	)
	assert.equal(authoredAnswer.state, 'completed', authoredAnswer.text)
	const firstDraft = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1', [owner])
	).rows
	assert.equal(
		firstDraft.length,
		1,
		'A reusable procedure creates one draft, not a trial artifact per model step.'
	)
	assert(firstDraft[0].published_artifact_id)
	const firstSkill = await artifacts.get(firstDraft[0].published_artifact_id)
	const firstDefinition = parseStudioSkillV2(firstSkill.payload)
	assert.equal(firstDefinition.steps.length, 1)
	assert.equal(firstDefinition.steps[0]!.kind, 'invoke')
	assert.match((firstDefinition.steps[0] as any).capabilityId, /markdown.*write/)
	assert(
		Object.keys(firstDefinition.parametersSchema.properties ?? {}).length >= 2,
		'Title and content remain editable public settings.'
	)
	assert(authoredAnswer.payload.toolCalls.some((call: any) => call.name === 'studio_publish'))
	qualifyToolCalls('first Skill authoring', authoredAnswer.payload.toolCalls)
	const revised = await f.admission.admit(
		await input(
			'Small refinement: rename that same Skill to "Session welcome note" and publish the revised version. Keep its operation, editable settings and other behavior unchanged. No execution.',
			{ kind: 'existing', id: authored.intentId }
		)
	)
	loseStudioFor = revised.turnId
	await createDispatcher().dispatch(f.turnScope, revised.turnId)
	await until(
		async () => (studioHeld ? true : undefined),
		'hold an actual Qwen draft edit before its tool checkpoint',
		120_000
	)
	const editRun = (
		await f.pool.query(
			`SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1`,
			[revised.turnId]
		)
	).rows[0]
	const originalEdit = (
		await f.workerPool.query('SELECT snapshot FROM studio_draft_receipts WHERE invocation_id=$1', [
			savedStudioInvocation
		])
	).rows[0].snapshot
	assert.equal(originalEdit.id, firstDraft[0].id)
	assert.equal(originalEdit.revision, firstDraft[0].revision + 1)
	assert.equal(originalEdit.definition.name, 'Session welcome note')
	assert.equal(
		(
			await f.workerPool.query('SELECT state FROM run_steps WHERE invocation_id=$1', [
				savedStudioInvocation
			])
		).rows[0].state,
		'pending'
	)
	// The earlier live failure spliced a wrong draft ID after recovery. Exercise
	// that rejection against the actual service, without fabricating an LLM reply
	// or mistaking it for an uncertain Store commit. The subsequent model journey
	// still has to recover the genuine edit and publish its exact current revision.
	const rejectionActor = studioBindings
		.get(revised.turnId)!
		.create({ operationId: savedStudioInvocation })
	try {
		const before = (
			await f.actorPool.query(
				'SELECT id,revision,published_artifact_id FROM studio_drafts WHERE subject_id=$1 ORDER BY id',
				[owner]
			)
		).rows
		const attempts = [...f.publicationAttempts.entries()]
		const rejection = await rejectionActor.deliver(
			'studio_publish',
			{ id: randomUUID(), revision: originalEdit.revision },
			{ operationId: savedStudioInvocation }
		)
		assert.equal(
			rejection.outcome,
			undefined,
			'A nonexistent draft is rejected before publication, not an uncertain mutation.'
		)
		assert.equal(JSON.parse(rejection.record).ok, false)
		assert.match(rejection.record, /DRAFT_UNAVAILABLE/)
		assert.match(rejection.record, /studio_state/)
		const malformed = await rejectionActor.deliver(
			'studio_author',
			{
				action: {
					action: { kind: 'edit', edits: [{ kind: 'rename', name: 'Not saved' }] },
					id: originalEdit.id,
					revision: originalEdit.revision
				}
			},
			{ operationId: savedStudioInvocation }
		)
		assert.equal(
			malformed.outcome,
			undefined,
			'A malformed local command is rejected before any save, not left awaiting recovery.'
		)
		assert.equal(JSON.parse(malformed.record).ok, false)
		assert.deepEqual(
			(
				await f.actorPool.query(
					'SELECT id,revision,published_artifact_id FROM studio_drafts WHERE subject_id=$1 ORDER BY id',
					[owner]
				)
			).rows,
			before
		)
		assert.deepEqual([...f.publicationAttempts.entries()], attempts)
		evidence.checks.preEffectStudioRejection = true
	} finally {
		rejectionActor.dispose()
	}
	await assert.rejects(
		() => f.actorPool.query('SELECT snapshot FROM studio_draft_receipts'),
		/permission denied/
	)
	await assert.rejects(
		() => f.workerPool.query('UPDATE studio_draft_receipts SET snapshot=snapshot'),
		/permission denied/
	)
	await assert.rejects(
		() => f.workerPool.query('DELETE FROM studio_draft_receipts'),
		/permission denied/
	)
	await runner.close()
	runner = createRunner()
	await f.pool.query(
		`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
		[editRun.id]
	)
	await runner.recoverAcceptedRuns()
	await until(
		async () =>
			(await runner!.status(editRun.id))?.lease?.ownerId !== editRun.record.lease.ownerId
				? true
				: undefined,
		'new owner recovers the exact Studio save'
	)
	releaseStudio()
	const revisedAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === revised.turnId),
		'real-model Studio refinement',
		240_000
	)
	assert.equal(revisedAnswer.state, 'completed', revisedAnswer.text)
	assert(revisedAnswer.payload.toolCalls.some((call: any) => call.name === 'studio_author'))
	qualifyToolCalls('same Skill refinement', revisedAnswer.payload.toolCalls)
	assert(
		revisedAnswer.payload.toolCalls.some(
			(call: any) => call.name === 'studio_author' && call.durationBasis === 'receipt-check'
		)
	)
	const revisedDrafts = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1', [owner])
	).rows
	assert.equal(revisedDrafts.length, 1)
	assert.equal(revisedDrafts[0].id, firstDraft[0].id)
	assert.equal(
		revisedDrafts[0].revision,
		originalEdit.revision,
		'Interrupted rename is not applied a second time.'
	)
	assert.deepEqual(
		(
			await f.workerPool.query(
				'SELECT snapshot FROM studio_draft_receipts WHERE invocation_id=$1',
				[savedStudioInvocation]
			)
		).rows[0].snapshot,
		originalEdit,
		'Publication cannot rewrite the original edit receipt.'
	)
	const revisedSkill = await artifacts.get(revisedDrafts[0].published_artifact_id)
	assert.notEqual(revisedSkill.artifactId, firstSkill.artifactId)
	assert.deepEqual(
		{ ...parseStudioSkillV2(revisedSkill.payload), name: firstDefinition.name },
		firstDefinition
	)
	const lineage: any = await artifacts.client.producerInputs(
		f.environmentId,
		revisedSkill.artifactId
	)
	assert(
		lineage.inputs.some(
			(edge: any) => edge.artifactId === firstSkill.artifactId && edge.role === 'predecessor'
		)
	)
	assert.deepEqual(
		(await artifacts.get(firstSkill.artifactId)).payload,
		firstSkill.payload,
		'Refinement never overwrites the earlier version.'
	)
	const variant = await f.admission.admit(
		await input(
			'Now make a separate variant called "Open workshop greeting" from the published Session welcome note. Its Markdown title must always be "Welcome to the open workshop"; Content should be its only editable setting. Keep the original Skill unchanged. Save, check and publish the variant, but do not execute anything.',
			{ kind: 'existing', id: authored.intentId }
		)
	)
	loseStudioPublicationFor = variant.turnId
	await createDispatcher().dispatch(f.turnScope, variant.turnId)
	await until(
		async () => (studioPublicationHeld ? true : undefined),
		'actual Skill Store commit loses its acknowledgement',
		180_000
	)
	const publicationRun = (
		await f.pool.query(
			`SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1`,
			[variant.turnId]
		)
	).rows[0]
	const unmarked = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1 AND id<>$2', [
			owner,
			firstDraft[0].id
		])
	).rows
	assert.equal(unmarked.length, 1)
	assert.equal(
		unmarked[0].published_artifact_id,
		null,
		'The draft head has not yet acknowledged the Store commit.'
	)
	const requestsBeforeRecovery = [...f.publicationAttempts.entries()]
	await runner.close()
	runner = createRunner()
	await f.pool.query(
		`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
		[publicationRun.id]
	)
	await runner.recoverAcceptedRuns()
	await until(
		async () =>
			(await runner!.status(publicationRun.id))?.lease?.ownerId !==
			publicationRun.record.lease.ownerId
				? true
				: undefined,
		'publication recovery owns a replacement lease'
	)
	releaseStudioPublication()
	const variantAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === variant.turnId),
		'real-model intentional Skill variant',
		240_000
	)
	assert.equal(variantAnswer.state, 'completed', variantAnswer.text)
	qualifyToolCalls('Skill variant', variantAnswer.payload.toolCalls)
	assert(
		variantAnswer.payload.toolCalls.some(
			(call: any) => call.name === 'studio_publish' && call.durationBasis === 'receipt-check'
		)
	)
	assert.deepEqual(
		[...f.publicationAttempts.entries()],
		requestsBeforeRecovery,
		'Recovery must not send another publication request.'
	)
	const variantDrafts = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1', [owner])
	).rows
	assert.equal(
		variantDrafts.length,
		2,
		'An explicitly separate variant creates one additional draft.'
	)
	const variantDraft = variantDrafts.find((row) => row.id !== firstDraft[0].id)!
	assert.equal(variantDraft.origin_artifact_id, revisedSkill.artifactId)
	const variantSkill = await artifacts.get(variantDraft.published_artifact_id)
	const variantDefinition = parseStudioSkillV2(variantSkill.payload)
	assert.equal(variantDefinition.steps.length, 1)
	const variantStep = variantDefinition.steps[0]!
	assert.equal(variantStep.kind, 'invoke')
	if (variantStep.kind !== 'invoke') throw Error('Expected the inherited Markdown operation.')
	assert.deepEqual(variantStep.parameters.title, {
		kind: 'literal',
		value: 'Welcome to the open workshop'
	})
	assert.equal(Object.keys(variantDefinition.parametersSchema.properties ?? {}).length, 1)
	assert.equal(variantStep.parameters.content.kind, 'parameter')
	const origin: any = await artifacts.client.producerInputs(
		f.environmentId,
		variantSkill.artifactId
	)
	assert(
		origin.inputs.some(
			(edge: any) => edge.artifactId === revisedSkill.artifactId && edge.role === 'origin'
		)
	)
	assert.deepEqual(
		variantDrafts.find((row) => row.id === firstDraft[0].id).definition,
		revisedDrafts[0].definition
	)
	const nested = await f.admission.admit(
		await input(
			'Reuse the published Open workshop greeting as a nested Skill inside a new parent called "Workshop welcome pack". Do not copy or rebuild its Markdown operation. Let the parent accept the greeting content and return the document produced by the child. Save, check and publish the parent; no execution.',
			{ kind: 'existing', id: authored.intentId }
		)
	)
	await createDispatcher().dispatch(f.turnScope, nested.turnId)
	const nestedAnswer: any = await until(
		async () => evidence.turns.find((turn: any) => turn.turnId === nested.turnId),
		'real-model nested Skill composition',
		240_000
	)
	assert.equal(nestedAnswer.state, 'completed', nestedAnswer.text)
	qualifyToolCalls('nested Skill', nestedAnswer.payload.toolCalls)
	const nestedDrafts = (
		await f.actorPool.query('SELECT * FROM studio_drafts WHERE subject_id=$1', [owner])
	).rows
	assert.equal(nestedDrafts.length, 3)
	const parentDraft = nestedDrafts.find(
		(row) => !variantDrafts.some((previous) => previous.id === row.id)
	)!
	const parentSkill = await artifacts.get(parentDraft.published_artifact_id)
	const parentDefinition = parseStudioSkillV2(parentSkill.payload)
	assert.equal(parentDefinition.steps.length, 1)
	const childStep = parentDefinition.steps[0]!
	assert.equal(childStep.kind, 'skill')
	if (childStep.kind !== 'skill')
		throw Error('Expected actual published-child reuse, not an operation copy.')
	assert.equal(childStep.skillArtifactId, variantSkill.artifactId)
	assert.equal(Object.keys(parentDefinition.parametersSchema.properties ?? {}).length, 1)
	assert(
		Object.values(parentDefinition.outputs).some(
			(port) => port.from.kind === 'step' && port.from.stepId === childStep.id
		)
	)
	const childInputs: any = await artifacts.client.producerInputs(
		f.environmentId,
		parentSkill.artifactId
	)
	assert(
		childInputs.inputs.some(
			(edge: any) => edge.artifactId === variantSkill.artifactId && edge.role === 'child'
		)
	)
	for (const answer of [authoredAnswer, revisedAnswer, variantAnswer, nestedAnswer]) {
		assert(
			answer.text.length < 450,
			'An operational completion should be a short usable receipt, not a schema tutorial.'
		)
		assert(
			!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(answer.text),
			'Internal identities remain inspectable without crowding the spoken completion.'
		)
		assert(!/maxLength|maxInvocations|maxConcurrentChildren|additionalProperties/.test(answer.text))
	}
	assert.equal((await f.repository().list(owner, {})).tasks.length, tasksBeforeStudio)
	const endedActor = studioBindings.get(revised.turnId)!.create({ operationId: randomUUID() })
	const endedRead = await endedActor.deliver('studio_state', {})
	assert.equal(
		JSON.parse(endedRead.record).ok,
		false,
		'Even later reads require live turn authority.'
	)
	endedActor.dispose()
	evidence.checks.studioAuthoring = {
		actualQwen: true,
		sharedActor: true,
		realDrafts: true,
		realPublications: true,
		preservedEditableSettings: true,
		sameDraftRefinement: true,
		immutablePredecessor: true,
		endedAuthorityDenied: true,
		intentionalVariant: true,
		fixedVariantSetting: true,
		preservedOrigin: true,
		nestedComposition: true,
		publishedChildReference: true,
		interruptedDraftEditRecovery: true,
		immutableEditReceipt: true,
		noDuplicateEdit: true,
		restrictedReceiptRole: true,
		conciseOperationalReceipts: true,
		interruptedPublicationRecovery: true,
		publicationHeadRepaired: true,
		noPublicationRedispatch: true,
		childExecution: false,
		casePublicationRecovery: false,
		nativeUI: false
	}
	// Independently invented manual process, followed by a new difficult case.
	// Both proposals remain hypothetical and unconfirmed: recovery cannot turn
	// the agent's suggestion into human authorization or silently enable it.
	const listedArtifacts = async (type: string): Promise<StudioArtifact[]> => {
		const page = await artifacts.list(type)
		assert(Array.isArray(page.items), 'The Store must return a typed artifact page.')
		assert(page.items.length < 128, 'The isolated scenario must fit in one complete page.')
		return page.items
	}
	const caseJourneys = [
		{
			title: 'Workshop tool closeout',
			turns: [
				[
					'studio_case_propose',
					'At our community workshop I have been checking the paper tool-loan sheet each evening, counting which clamps are still out, and writing a closeout note for the next steward. Save this as a real-case proposal called "Workshop tool closeout" and show its what-if plan. This is my recollection, not a claim that the old sheet is stored here. We do not have an Actor that reads that paper sheet or a digital loan feed yet, so mark that missing step as ideal. Do not create or publish an executable Skill, confirm the case, run it or add tasks.'
				],
				[
					'studio_case_revise',
					'Wait, another thing from yesterday: tools may come back damaged. Revise that same saved case so damaged returns are counted separately from tools still out, and uncertain counts require a person to review them. Keep the existing evidence and procedure. Save the revised proposal and show what-if again, without confirming it, creating a Skill or running anything.'
				]
			]
		},
		{
			title: 'Saatgutproben erfassen',
			turns: [
				[
					'studio_case_propose',
					'Ich erfasse ehrenamtlich Saatgutproben: Etikett abschreiben, gleiche Probennummern erkennen und einen Übergabebericht schreiben. Das ist meine Erinnerung, keine hier gespeicherte Datei. Speichere einen unbestätigten Fallvorschlag „Saatgutproben erfassen“ und zeige What-if. Ein Scanner und der Zugriff auf das Probenregister fehlen: als ideale Schritte kennzeichnen. Bei doppelten Nummern muss eine Person die Zuordnung prüfen, bevor die Probe im endgültigen Bericht erscheint. Nichts ausführen, keinen Skill bauen oder veröffentlichen, keine Aufgaben erstellen.'
				],
				[
					'studio_case_revise',
					'Complète ce même scénario : même après examen, une personne peut décider que le lien entre deux échantillons reste indéterminé. Cette décision humaine doit être conservée ; elle ne dispense pas de l’examen. Conserve les preuves et les étapes existantes, enregistre seulement une proposition révisée et montre le what-if. Ne confirme et n’exécute rien, ne crée pas de Skill ni de tâche.'
				]
			]
		},
		{
			title: 'Notas de ensayos musicales',
			turns: [
				[
					'studio_case_propose',
					'En los ensayos de nuestro coro anoto a mano qué canciones se practicaron y preparo una nota para el siguiente ensayo. Es un recuerdo, no hay registros históricos aquí. Guarda una propuesta no confirmada llamada «Notas de ensayos musicales» y muestra su what-if. Falta el acceso al cuaderno de ensayos; represéntalo como paso ideal. Si una duración falta, la nota debe decir «duración desconocida» y continuar: no quiero aprobación humana para este caso. No construyas ni publiques un Skill, no ejecutes nada ni crees tareas.'
				],
				[
					'studio_case_revise',
					'small tweak to that same proposal: count planned-but-skipped songs separately from practiced songs. keep the original steps and evidence. Missing duration is still just a warning, not a reason to stop or ask someone. Save the revised proposal and show what-if only; no confirmation, executable Skill, run or tasks.'
				]
			]
		}
	] as const
	for (const journey of caseJourneys) {
		let caseIntent = '',
			previousCase: Awaited<ReturnType<StudioCases['read']>> | undefined
		for (const [name, text] of journey.turns) {
			const beforeCases = await listedArtifacts('studio.case')
			const beforeSkills = await listedArtifacts('studio.skill')
			const proposal = await f.admission.admit(
				await input(
					text,
					caseIntent ? { kind: 'existing', id: caseIntent } : { kind: 'new', title: journey.title }
				)
			)
			caseIntent = proposal.intentId
			let release = () => {}
			const gate = new Promise<void>((resolve) => {
				release = resolve
			})
			const interruption = { name, held: false, release, gate }
			caseInterruptions.set(proposal.turnId, interruption)
			await createDispatcher().dispatch(f.turnScope, proposal.turnId)
			await until(
				async () => (interruption.held ? true : undefined),
				`actual ${name} Store reply lost`,
				180_000
			)
			const committedCases = await listedArtifacts('studio.case')
			assert.equal(committedCases.length, beforeCases.length + 1)
			const committed = committedCases.find(
				(a) => !beforeCases.some((b) => b.artifactId === a.artifactId)
			)!
			const cases = new StudioCases(artifacts),
				saved = await cases.read(committed.artifactId)
			assert.equal(saved.record.status, 'proposed')
			assert(saved.record.case.steps.some((step) => step.kind === 'ideal'))
			assert.equal(saved.record.predecessorArtifactId, previousCase?.artifact.artifactId ?? null)
			if (previousCase) {
				for (const original of previousCase.record.case.evidence) {
					const retained = saved.record.case.evidence.find((item) => item.id === original.id)
					assert(retained, 'A refinement retains the original evidence identity.')
					for (const field of ['kind', 'sourceId', 'quote'] as const)
						assert.equal(
							retained[field],
							original[field],
							'A refinement retains its original source and quotation.'
						)
					// A locator may legitimately change from "current request" to "first
					// request"; explanatory wording is not the evidence's source identity.
				}
				for (const original of previousCase.record.case.steps)
					assert(
						saved.record.case.steps.some(
							(step) => step.id === original.id && step.kind === original.kind
						),
						'The additive refinement preserves the existing procedure.'
					)
				assert.deepEqual(
					(await cases.read(previousCase.artifact.artifactId)).record,
					previousCase.record
				)
			}
			const attempts = [...f.publicationAttempts.entries()]
			const currentRun = (
				await f.pool.query(
					`SELECT id,record FROM aven_actor_runs.runs WHERE record->'parameters'->>'turnId'=$1`,
					[proposal.turnId]
				)
			).rows[0]
			await runner.close()
			runner = createRunner()
			await f.pool.query(
				`UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
				[currentRun.id]
			)
			await runner.recoverAcceptedRuns()
			await until(
				async () =>
					(await runner!.status(currentRun.id))?.lease?.ownerId !== currentRun.record.lease.ownerId
						? true
						: undefined,
				'case recovery has a fresh worker lease'
			)
			release()
			const answer: any = await until(
				async () => evidence.turns.find((turn: any) => turn.turnId === proposal.turnId),
				'case proposal recovered and explained',
				240_000
			)
			assert.equal(answer.state, 'completed', answer.text)
			assert(
				answer.payload.toolCalls.some(
					(call: any) => call.name === name && call.durationBasis === 'receipt-check'
				)
			)
			const simulation = answer.payload.toolCalls.findLast(
				(call: any) => call.name === 'studio_case_what_if'
			)
			assert(simulation, 'The requested what-if inspection must actually run.')
			// Saved chat history intentionally omits large outcomes. Assert execution
			// semantics against the actual worker journal, not a truncated UI receipt.
			const toolSteps = (
				await f.workerPool.query(
					"SELECT value FROM run_steps WHERE run_id=$1 AND kind='tool' ORDER BY ordinal",
					[currentRun.id]
				)
			).rows
			assert.equal(toolSteps.length, answer.payload.toolCalls.length)
			// A stochastic author may correct one malformed proposal. Qualify that
			// recovery rather than rerunning until lucky: the rejection must be settled,
			// the next mutation must correct that same method. Failed reads, retry loops and uncertain
			// effects are not accepted as harmless authoring corrections.
			const rejected = answer.payload.toolCalls.filter((call: any) => call.status === 'failed')
			assert(rejected.length <= 1, 'Case authoring must not devolve into retry loops.')
			for (const call of rejected) {
				const index = answer.payload.toolCalls.indexOf(call)
				assert.equal(call.name, name)
				const result = toolSteps[index].value.result
				assert.equal(JSON.parse(result.record).ok, false)
				assert.notEqual(result.outcome, 'uncertain')
				const next = answer.payload.toolCalls
					.slice(index + 1)
					.find((later: any) => later.name === name)
				assert.equal(
					next?.status,
					'completed',
					'The rejected proposal must be corrected successfully.'
				)
			}
			// Recovery must never repeat the interrupted publication. A model may,
			// however, correct the recovered plan by explicitly revising its immutable
			// successor. Qualify that separately: at most one correction, linear lineage,
			// preserved evidence/procedure, and one write per actual publication.
			const writes = toolSteps.filter(
				(step: any) =>
					['studio_case_propose', 'studio_case_revise'].includes(step.value.command.name) &&
					answer.payload.toolCalls[toolSteps.indexOf(step)].status === 'completed'
			)
			assert(
				writes.length >= 1 && writes.length <= 2,
				'At most one saved-plan correction is allowed.'
			)
			let finalSaved = saved
			const versions = [saved]
			for (const [index, step] of writes.entries()) {
				// Both public tools return the immutable publication directly. The
				// "inspect" operation, not "revise", wraps it in an artifact field.
				const artifact = JSON.parse(step.value.result.record)
				assert.equal(artifact?.typeKey, 'studio.case')
				assert.equal(step.value.command.name, index === 0 ? name : 'studio_case_revise')
				if (index === 0) {
					assert.equal(artifact.artifactId, committed.artifactId)
					assert.deepEqual(artifact.payload, saved.record)
					continue
				}
				assert.equal(
					JSON.parse(step.value.command.args).predecessorArtifactId,
					finalSaved.artifact.artifactId
				)
				const corrected = await cases.read(artifact.artifactId)
				assert.notEqual(corrected.artifact.artifactId, finalSaved.artifact.artifactId)
				assert.equal(corrected.record.status, 'proposed')
				assert.equal(corrected.record.predecessorArtifactId, finalSaved.artifact.artifactId)
				for (const original of finalSaved.record.case.evidence)
					assert.deepEqual(
						corrected.record.case.evidence.find((item) => item.id === original.id),
						original,
						'A corrective successor cannot rewrite or replace existing evidence.'
					)
				// Appending the current user's actual refinement is valid; demanding
				// array equality confused adding evidence with changing a predecessor.
				for (const added of corrected.record.case.evidence.filter(
					(item) => !finalSaved.record.case.evidence.some((original) => original.id === item.id)
				)) {
					assert(
						added.quote && text.includes(added.quote),
						'This corrective successor may add quoted requirements from this contribution, not invented evidence.'
					)
				}
				for (const original of finalSaved.record.case.steps)
					assert(
						corrected.record.case.steps.some(
							(step) => step.id === original.id && step.kind === original.kind
						),
						'A corrective successor preserves the existing procedure.'
					)
				assert(corrected.record.case.steps.some((step) => step.kind === 'ideal'))
				assert.deepEqual(artifact.payload, corrected.record)
				versions.push(corrected)
				finalSaved = corrected
			}
			for (const version of versions)
				assert.deepEqual(
					(await cases.read(version.artifact.artifactId)).record,
					version.record,
					'Every saved predecessor stays immutable.'
				)
			const finalCases = await listedArtifacts('studio.case')
			assert.deepEqual(
				finalCases.map((item) => item.artifactId).sort(),
				[...beforeCases, ...versions.map((item) => item.artifact)]
					.map((item) => item.artifactId)
					.sort()
			)
			for (const [id, count] of attempts)
				assert.equal(
					f.publicationAttempts.get(id),
					count,
					'Recovery must not redispatch any previous publication.'
				)
			const extraWrites = [...f.publicationAttempts].filter(
				([id]) => !attempts.some(([prior]) => prior === id)
			)
			assert.deepEqual(
				extraWrites,
				versions.slice(1).map((item) => [item.artifact.publicationId, 1]),
				'Only one new write for each explicit corrective successor is permitted.'
			)
			assert.equal(
				JSON.parse(simulation.arguments).artifactId,
				finalSaved.artifact.artifactId,
				'The final what-if must inspect the actual final version.'
			)
			const simulationResult =
				toolSteps[answer.payload.toolCalls.indexOf(simulation)].value.result.record
			assert.equal(JSON.parse(simulationResult).executes, false)
			assert.deepEqual(
				JSON.parse(simulationResult),
				await cases.whatIf(finalSaved.artifact.artifactId)
			)
			// Qualify the actual stored plan, not an invented one-line completion fed
			// to the product's answer reviewer. That would test the harness's missing
			// explanation instead of whether the requested conditions were preserved.
			const qualification = planAuditMessages({
				request: text,
				previousCase: previousCase?.record.case ?? null,
				saved: finalSaved.record,
				whatIf: JSON.parse(simulationResult)
			})
			let auditText = '',
				finish = ''
			evidence.caseProposals ??= []
			const qualifiedCase: any = {
				request: text,
				saved: finalSaved.record,
				versions: versions.map((item) => item.record),
				simulation: JSON.parse(simulationResult),
				qualification,
				settledAuthoringCorrections: rejected.length,
				savedPlanCorrections: versions.length - 1
			}
			evidence.caseProposals.push(qualifiedCase)
			await save()
			for await (const event of modelFor(`${proposal.turnId}:qualification`)(
				qualification,
				[],
				undefined,
				undefined,
				answerReviewOptions(0)
			)) {
				if (event.kind === 'text') auditText += event.text
				if (event.kind === 'finish') finish = event.reason
			}
			qualifiedCase.audit = { text: auditText, finish }
			await save()
			assert.equal(finish, 'stop')
			const semanticReview = parsePlanAudit(auditText)
			qualifiedCase.semanticReview = semanticReview
			await save()
			assert.equal(
				semanticReview.verdict,
				'pass',
				'Saved case must actually preserve the requested mandatory conditions: ' +
					JSON.stringify(semanticReview)
			)
			assert.equal(semanticReview.issues.length, 0)
			assert.equal((await listedArtifacts('studio.skill')).length, beforeSkills.length)
			assert.equal((await f.repository().list(owner, {})).tasks.length, tasksBeforeStudio)
			previousCase = finalSaved
		}
	}
	evidence.checks.studioAuthoring.casePublicationRecovery = true
	evidence.checks.caseRecovery = {
		newProposal: true,
		revisedProposal: true,
		immutablePredecessor: true,
		missingStepRemainsIdeal: true,
		noSelfConfirmation: true,
		noExecutablePublication: true,
		noRedispatch: true,
		actualWhatIf: true
	}
	evidence.tasks = (await f.repository().list(owner, {})).tasks
	assert.equal(
		evidence.qualityFailures.length,
		0,
		'Journey completed but recovered tool errors still fail the interaction-quality gate: ' +
			JSON.stringify(evidence.qualityFailures)
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	if (fixture) {
		evidence.serviceErrors = fixture.logs
		// Retain the synthetic failure before fixture teardown; never label a timed
		// out turn flaky without its actual runner/journal observations.
		evidence.failedRuns = (
			await fixture.pool.query('SELECT id,state,record FROM aven_actor_runs.runs')
		).rows
		evidence.failedSteps = (
			await fixture.pool.query(
				'SELECT run_id,ordinal,kind,state,value FROM aven_actor_runs.run_steps ORDER BY run_id,ordinal'
			)
		).rows
	}
	throw error
} finally {
	blockSlow = false
	releaseSlow()
	releaseLostEffect()
	releasePublication()
	releaseHistory()
	releaseStudio()
	releaseStudioPublication()
	releaseArchiveEffect()
	releaseStopEffect()
	for (const interruption of caseInterruptions.values()) interruption.release()
	await worker?.close()
	await runner?.close()
	await fixture?.close()
	await modelService?.stop(true)
	evidence.completedAt = new Date().toISOString()
	await save()
	console.log(
		JSON.stringify({
			evidence: join(directory, 'evidence.json'),
			passed: evidence.passed,
			modelRequests: evidence.models.length
		})
	)
}
