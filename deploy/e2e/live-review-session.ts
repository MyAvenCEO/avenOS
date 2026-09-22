/** Real-model proof of shared durable review. Uses only a disposable provisioned DB. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type pg from 'pg'
import {
	ACTOR_RUN_PROTOCOL,
	Actor,
	ActorRegistry,
	authorizeRegistryForPlanning,
	definitionFromManifest,
	executeStudioProgram,
	invokeActorCapability,
	type PlanRunRecord,
	parseStudioSkillV2,
	resourceId
} from '../../libs/aven-actors/src/index'
import { ChatCore } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import {
	databaseNameForEnvironment,
	signTenantGrant
} from '../../libs/aven-customer-contracts/src/index'
import { IdentityVerifier } from '../../libs/aven-identity/src/index'
import {
	AdmittedInvocations,
	admittedInvocationId
} from '../../services/actor-runner/src/admitted-invocations'
import { createActorRunnerHandler } from '../../services/actor-runner/src/handler'
import { installedFactory } from '../../services/actor-runner/src/installed-runtime'
import { createInvocationGuardHandler } from '../../services/actor-runner/src/invocation-guard-handler'
import {
	type ReviewRecord,
	type ReviewScope,
	ReviewStore,
	requestRunReview,
	reviewContinuation,
	WaitingForReview
} from '../../services/actor-runner/src/reviews'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

export async function proveReviewSession(
	api: pg.Pool,
	worker: pg.Pool,
	scope: ReviewScope,
	baseUrl: string
) {
	const model = process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next'
	assert(/qwen/i.test(model))
	const directory = await mkdtemp('/tmp/aven-live-review-session-')
	console.log(directory)
	const evidence = {
		passed: false,
		model,
		synthetic: true,
		scope:
			'Real Qwen, real provisioned PostgreSQL roles, actual JWT ingress, shared SQL runner, Studio review gates and admitted Actor dispatch with live SQL lease checks. Not native UI, Artifact Store publication or credential-use policy proof.',
		answers: [] as string[],
		states: [] as string[],
		modelExecutions: 0,
		admittedInvocations: 0
	}
	const keys = await generateKeyPair('EdDSA'),
		jwk = await exportJWK(keys.publicKey)
	const jwks = createServer((_request, response) =>
		response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'proof', alg: 'EdDSA', use: 'sig' }] }))
	)
	await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve))
	const issuer = `http://127.0.0.1:${(jwks.address() as { port: number }).port}`
	const serviceToken = randomUUID() + randomUUID(),
		sessionId = randomUUID()
	const token = await new SignJWT({
		sid: sessionId,
		email: 'orchard@example.test',
		email_verified: true,
		role: 'user',
		amr: ['passkey'],
		scope: 'services:access'
	})
		.setProtectedHeader({ alg: 'EdDSA', kid: 'proof' })
		.setSubject(scope.subjectId)
		.setIssuer(issuer)
		.setAudience('aven-services')
		.setIssuedAt()
		.setExpirationTime('10m')
		.sign(keys.privateKey)
	const gateway = LlmGatewayService.fromConfig(
		testConfig({
			LLM_GATEWAY_ENABLED: 'true',
			LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
			LLM_GATEWAY_TIMEOUT_SECONDS: '180',
			LLM_GATEWAY_MODELS_JSON: JSON.stringify([
				{
					id: 'proof',
					label: 'Live review proof',
					baseUrl,
					upstreamModel: model,
					profile: 'qwen-tools',
					authMode: 'none',
					capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
				}
			])
		})
	)!
	const stream = createGatewayModelStream({
		request: (input) => chatGatewayRequest({ ...input, model: 'proof' }, 8192),
		open: async function* (input, signal) {
			const response = await gateway.openAiChatCompletion(input, signal)
			assert(response.ok && response.body)
			const decoder = new TextDecoder()
			for await (const chunk of response.body) yield decoder.decode(chunk, { stream: true })
			yield decoder.decode()
		}
	})
	const definition = parseStudioSkillV2({
		version: 2,
		name: 'Orchard briefing',
		inputs: {},
		outputs: {},
		parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
		policy: {
			allowModel: true,
			maxInvocations: 4,
			maxDepth: 2,
			maxMembers: 8,
			maxConcurrentChildren: 1
		},
		steps: [
			{
				id: 'read',
				kind: 'review',
				label: 'Read orchard stock?',
				subjectSchema: 'example:schema:orchard:stock-review@1',
				subjects: {},
				outputs: {}
			},
			{
				id: 'brief',
				kind: 'review',
				label: 'Prepare orchard briefing?',
				subjectSchema: 'example:schema:orchard:brief-review@1',
				subjects: {},
				outputs: {}
			},
			{
				id: 'write',
				kind: 'invoke',
				label: 'Write the approved briefing',
				capabilityId: 'example:capability:orchard:brief@1',
				inputs: {},
				parameters: {},
				outputs: {}
			}
		]
	})
	let runner: SqlPlanRunner
	const admissions = new AdmittedInvocations(
		{ environmentId: scope.environmentId, generation: scope.generation },
		worker
	)
	const makeRunner = () =>
		new SqlPlanRunner(
			api,
			worker,
			async (request, context) => {
				try {
					const result = await executeStudioProgram({
						definition,
						children: new Map(),
						inputs: {},
						parameters: {},
						signal: context?.signal,
						host: {
							read: async () => {
								throw Error('No artifacts in this review boundary proof')
							},
							review: async ({ id, step }) => {
								await requestRunReview(new ReviewStore(worker, scope), context, {
									invocationId: id,
									subjectSchema: step.subjectSchema,
									title: step.label,
									subject: { operation: step.label, requestId: request.requestId }
								})
							},
							invoke: async ({ id }) => {
								assert(context?.lease && context.session)
								const readScope = {
									...scope,
									sessionId: context.session.sessionId,
									runId: context.lease.runId,
									invocationId: await admittedInvocationId(context.lease.runId, id)
								}
								await assert.rejects(admissions.read(readScope), /INVOCATION_NOT_ACTIVE/)
								const manifest = {
									id: 'briefing',
									authority: 'example',
									namespace: 'orchard',
									version: '1',
									name: 'Orchard briefing',
									description: 'Write an approved fictional briefing.',
									tags: [],
									methods: [
										{
											name: 'brief',
											description: 'Write a briefing using the real model.',
											parameters: { type: 'object' as const, additionalProperties: false },
											requires: [],
											produces: [],
											inputSlots: [],
											outputSlots: []
										}
									]
								}
								const factory = installedFactory(manifest, scope.environmentId, () => {
									const actor = new Actor(manifest, {
										brief: async () => {
											assert.equal((await admissions.read(readScope)).stepId, id)
											evidence.modelExecutions++
											const chat = new ChatCore(
												{},
												{
													specs: [],
													run: async () => {
														throw Error('No tools available')
													}
												},
												stream,
												stream
											)
											await chat.send(
												'Write one sentence in German: the fictional orchard has 17 pear saplings ready. Use only that fact, no claims about fetching or saving.'
											)
											const answer =
												chat.turns.filter((t) => t.role === 'assistant').at(-1)?.content ?? ''
											assert.match(answer, /17/)
											evidence.answers.push(answer)
											return { record: JSON.stringify({ ok: true, outputs: {} }), wire: answer }
										}
									})
									return { actor, dispose: () => actor.dispose() }
								})
								const registry = new ActorRegistry()
								registry.registerDefinition(definitionFromManifest(manifest))
								registry.publishOffer(factory.offer)
								const snapshot = registry.snapshot()
								const authorizer = {
									decide: (
										check: import('../../libs/aven-actors/src/index').ActorAuthorizationRequest
									) =>
										check.principal.subjectId === scope.subjectId &&
										check.access.tenantId === scope.environmentId
											? { allow: true as const, decisionId: 'synthetic-owner' }
											: {
													allow: false as const,
													decisionId: 'synthetic-denied',
													reasonCode: 'SCOPE'
												}
								}
								const view = await authorizeRegistryForPlanning(
									snapshot,
									request.security.principal,
									authorizer,
									{ access: request.security.access }
								)
								const available = view.capabilities[0]!,
									target = available.targets[0]!
								const response = await invokeActorCapability(
									{
										runId: request.idempotencyKey,
										registry: snapshot,
										principal: request.security.principal,
										access: request.security.access,
										authorizer,
										factories: {
											resolve: (key) => (key === factory.offer.factoryId ? factory : undefined)
										},
										signal: context.signal,
										invocationHost: admissions.host(request, context, async (record) => {
											evidence.admittedInvocations++
											assert.equal(record.capabilityId, available.capability.id)
											assert.equal(record.leaseOwnerId, context.lease!.ownerId)
											const input = { runId: readScope.runId, invocationId: readScope.invocationId }
											const guarded = await call('/internal/v1/invocations/read', input)
											assert.equal(guarded.status, 200, await guarded.text())
											for (const headers of [
												{ origin: 'https://foreign.example.test' },
												{ cookie: 'session=not-authority' },
												{ 'x-aven-work-grant': 'copied' },
												{ authorization: 'Bearer not-the-private-service' }
											] as Array<Record<string, string>>)
												assert.equal(
													(await call('/internal/v1/invocations/read', input, headers)).status,
													403
												)
											for (const changed of [
												{ subjectId: randomUUID() },
												{ sessionId: randomUUID() },
												{ runId: randomUUID() },
												{ generation: scope.generation + 1 }
											])
												await assert.rejects(
													admissions.read({ ...readScope, ...changed }),
													/INVOCATION_NOT_ACTIVE/
												)
										}),
										artifacts: {
											resolve: async () => null,
											publish: async () => {
												throw Error('No publication in this boundary proof')
											}
										},
										program: {
											goals: [],
											steps: [],
											results: [],
											totalCost: 0,
											registryRevision: snapshot.revision,
											plannedFor: { subjectId: scope.subjectId, tenantId: scope.environmentId },
											executionEnvironment: 'server'
										}
									},
									{
										id,
										capability: available.capability.id,
										actor: available.capability.actor,
										method: 'brief',
										inputs: [],
										outputs: [],
										dependsOn: [],
										cost: 1,
										target
									},
									snapshot.definitions
										.flatMap((d) => d.capabilities)
										.find((c) => c.id === available.capability.id)!,
									[],
									new Set()
								)
								assert.equal(JSON.parse(response.record).ok, true)
								await assert.rejects(admissions.read(readScope), /INVOCATION_NOT_ACTIVE/)
								return {}
							}
						}
					})
					return { ...result, artifactIds: [], remainingGoals: [] }
				} catch (error) {
					if (!(error instanceof WaitingForReview)) throw error
					return { remainingGoals: request.goals, continuation: reviewContinuation(error.record) }
				}
			},
			true,
			180000
		)
	runner = makeRunner()
	const verifier = new IdentityVerifier({ issuer })
	const invocationGuard = createInvocationGuardHandler(
		{ serviceToken, issuer, key: keys.publicKey },
		verifier,
		async () => admissions
	)
	const handler = createActorRunnerHandler(
		{ forGrant: async () => runner, reviewsForGrant: async () => new ReviewStore(api, scope) },
		verifier,
		{ serviceToken, tenantGrantIssuer: issuer, tenantGrantPublicKey: keys.publicKey }
	)
	const componentRef = 'os.aven:component:actors:run-repository@1'
	async function call(path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
		const internal = path === '/internal/v1/invocations/read'
		const grant = await signTenantGrant(
			{
				iss: issuer,
				aud: componentRef,
				sub: scope.subjectId,
				sid: sessionId,
				role: 'user',
				membershipRole: 'member',
				environmentId: scope.environmentId,
				databaseName: databaseNameForEnvironment(scope.environmentId),
				routingGeneration: scope.generation,
				componentRef,
				actions: [internal || body === undefined ? 'actor-runs:read' : 'actor-runs:write']
			},
			keys.privateKey
		)
		return (internal ? invocationGuard : handler)(
			new Request('http://runner.example.test' + (internal ? '' : '/api/actor-runs') + path, {
				method: body === undefined ? 'GET' : 'POST',
				headers: {
					authorization: `Bearer ${serviceToken}`,
					'x-aven-identity-token': token,
					'x-aven-tenant-grant': grant,
					'x-aven-subject': scope.subjectId,
					'x-aven-role': 'user',
					'x-aven-session': sessionId,
					'content-type': 'application/json',
					...extraHeaders
				},
				body: body === undefined ? undefined : JSON.stringify(body)
			})
		)
	}
	async function settled(runId: string, afterRevision = 0) {
		for (let n = 0; n < 3600; n++) {
			const record = await runner.status(runId)
			if (
				record &&
				record.revision > afterRevision &&
				!['accepted', 'planning', 'running'].includes(record.state)
			) {
				evidence.states.push(record.state)
				return record
			}
			await new Promise((resolve) => setTimeout(resolve, 50))
		}
		throw Error('Review run did not settle')
	}
	const decision = async (run: PlanRunRecord, outcome: 'approve' | 'deny' | 'postpone') => {
		const pending = run.continuations.find((c) => c.state === 'open' || c.state === 'postponed')!
		const response = await call(`/${run.runId}/reviews/${pending.review!.id}`)
		assert.equal(response.status, 200)
		const review = (await response.json()) as ReviewRecord
		const body = {
			id: randomUUID(),
			revision: review.revision,
			subjectDigest: review.subjectDigest,
			expectedEventVersion: review.eventVersion,
			outcome
		}
		assert.equal(
			(
				await call(`/${run.runId}/reviews/${review.id}`, body, {
					'x-aven-work-grant': 'model-cannot-approve'
				})
			).status,
			401
		)
		const saved = await call(`/${run.runId}/reviews/${review.id}`, body)
		assert.equal(saved.status, 200, await saved.text())
		if (outcome === 'postpone') return run
		const resumed = await call(`/${run.runId}/continuations/${pending.continuationId}`, {
			requestId: randomUUID(),
			continuationId: pending.continuationId,
			action: 'submit',
			kind: 'approval',
			value: true
		})
		assert.equal(resumed.status, 202, await resumed.text())
		return settled(run.runId, run.revision)
	}
	try {
		for (const deny of [true, false]) {
			let run: PlanRunRecord | undefined
			const chat = new ChatCore(
				{},
				{
					specs: [
						{
							name: 'prepare_orchard_brief',
							description:
								'Start a durable briefing. This pauses for explicit review before using data. A waiting result is not completion.',
							parameters: { type: 'object', properties: {}, additionalProperties: false },
							answerReview: 'required'
						}
					],
					run: async () => {
						const response = await call('', {
							protocol: ACTOR_RUN_PROTOCOL,
							requestId: randomUUID(),
							idempotencyKey: randomUUID(),
							requestedAt: new Date().toISOString(),
							skillRef: resourceId({
								authority: 'example',
								kind: 'skill',
								namespace: 'orchard',
								name: 'brief',
								version: '1'
							}),
							executionEnvironment: 'server',
							ingredients: [],
							goals: ['example.orchard.brief(done)'],
							parameters: {}
						})
						assert.equal(response.status, 202, response.status === 202 ? '' : await response.text())
						run = await settled(((await response.json()) as { runId: string }).runId)
						const record = JSON.stringify({
							state: run.state,
							message: 'Human approval is required in the review card. No briefing was created.'
						})
						return { wire: record, record }
					}
				},
				stream,
				stream
			)
			await chat.send(
				deny ? 'Bereite bitte den Obstgartenbericht vor.' : 'Please prepare the orchard briefing.'
			)
			evidence.answers.push(chat.turns.filter((t) => t.role === 'assistant').at(-1)?.content ?? '')
			assert(run)
			assert.equal(run.state, 'waiting_for_input')
			const pending = run.continuations[0]!
			assert.equal(
				(
					await call(`/${run.runId}/continuations/${pending.continuationId}`, {
						requestId: randomUUID(),
						continuationId: pending.continuationId,
						action: 'submit',
						kind: 'approval',
						value: true
					})
				).status,
				409
			)
			await decision(run, 'postpone')
			// Actual runner replacement: no in-memory approval survives on its own.
			await runner.close()
			runner = makeRunner()
			run = await decision(run, 'approve')
			assert.equal(run.state, 'waiting_for_input')
			run = await decision(run, deny ? 'deny' : 'approve')
			assert.equal(run.state, deny ? 'failed' : 'succeeded')
			assert.equal(evidence.modelExecutions, deny ? 0 : 1)
		}
		evidence.passed = true
	} finally {
		await runner.close()
		jwks.closeAllConnections()
		await new Promise<void>((resolve) => jwks.close(() => resolve()))
		await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
	}
}
