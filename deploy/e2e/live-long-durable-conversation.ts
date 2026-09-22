/** An evolving, persisted conversation with real Qwen and production worker wiring.
 * This complements provider-capacity probes; it does not force the bounded host to
 * send an entire transcript or claim to exercise a native microphone/window. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import type { InputAdmission } from '@avenos/intents/admission'
import { IntentWorkRequestError, RemoteIntentWork } from '@avenos/intents/remote'
import { type TurnProgress, turnProgressSchema } from '@avenos/intents/turn-progress'
import { TrustedActorInstallations } from '../../libs/aven-actors/src'
import { IdentityVerifier } from '../../libs/aven-identity/src'
import { HttpLlmGatewayClient } from '../../libs/aven-llm-client/src/http'
import type { InputRoute } from '../../libs/aven-llm-client/src/input-decision'
import { createBackgroundChatHost } from '../../services/actor-runner/src/background-chat'
import {
	CHAT_TURN_SKILL,
	createChatTurnExecutor
} from '../../services/actor-runner/src/chat-executor'
import { createDocumentCatalogSource } from '../../services/actor-runner/src/document-catalog'
import {
	createMarkdownRuntimeFactory,
	installMarkdownRuntimeActor
} from '../../services/actor-runner/src/markdown-runtime'
import { ActorRecoveryWorker } from '../../services/actor-runner/src/recovery-worker'
import { SqlPlanRunner } from '../../services/actor-runner/src/sql-runner'
import { StudioArtifacts } from '../../services/actor-runner/src/studio-artifacts'
import { createFacadeHandler } from '../../services/aven-api/src/facade'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { createIntentTurnRuntime } from '../../services/intent-service/src/turn-runtime'
import { taskServiceFixture } from './task-service-fixture'

const database = process.env.TEST_TASK_DATABASE_URL,
	base = process.env.LIVE_LLM_BASE_URL,
	upstream = process.env.LIVE_LLM_MODEL
assert(database && base && upstream && /qwen/i.test(upstream))
const directory = await mkdtemp('/tmp/aven-long-durable-conversation-')
const labels = {
	original: `TEST-${randomBytes(6).toString('hex')}`,
	current: `TEST-${randomBytes(6).toString('hex')}`,
	other: `TEST-${randomBytes(6).toString('hex')}`
}
const evidence: any = {
	synthetic: true,
	passed: false,
	upstream,
	labels,
	answers: [],
	requests: [],
	routes: [],
	progress: [],
	qualityFailures: [],
	fingerprints: {},
	startedAt: new Date().toISOString(),
	scope:
		'Sequential actual Qwen exchanges through signed HTTP admission, production background Chat/tool host and isolated PostgreSQL. Worker reconstruction and history retrieval beyond the rolling context. Not native UI, acoustic speech or a provider-capacity probe.'
}
for (const path of [
	'deploy/e2e/live-long-durable-conversation.ts',
	'deploy/e2e/task-service-fixture.ts',
	'services/actor-runner/src/background-chat.ts',
	'services/actor-runner/src/chat-host.ts',
	'services/actor-runner/src/chat-journal.ts',
	'services/actor-runner/src/chat-progress.ts',
	'libs/aven-intents/src/turn-progress.ts',
	'services/actor-runner/src/history-actor.ts',
	'services/intent-service/src/store.ts',
	'services/intent-service/src/turn-outbox.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/history-selection.ts',
	'libs/aven-chat-engine/src/research.ts',
	'libs/aven-intents/src/admission.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const digest = createHash('sha256').update(JSON.stringify(evidence.fingerprints)).digest('hex')
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const owner = randomUUID(),
	intentId = randomUUID(),
	token = randomUUID() + randomUUID()
const config = testConfig({
	LLM_GATEWAY_ENABLED: 'true',
	LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
	LLM_GATEWAY_ACTOR_RUNNER_BEARER_TOKEN: token,
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
const gateway = LlmGatewayService.fromConfig(config)!
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined,
	server: ReturnType<typeof Bun.serve> | undefined,
	runner: SqlPlanRunner | undefined,
	runtime: ReturnType<typeof createIntentTurnRuntime> | undefined,
	recovery: ActorRecoveryWorker | undefined
let active = 'setup'
try {
	const handler = createFacadeHandler(
		config,
		new IdentityVerifier({ issuer: 'https://identity.example.test' }),
		undefined,
		undefined,
		undefined,
		undefined,
		gateway
	)
	server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		idleTimeout: 255,
		fetch: async (request) => {
			if (request.method === 'POST') {
				const body = await request.clone().json()
				// Inspect the actual model envelope, never add missing historical information.
				const serialized = JSON.stringify(body.messages)
				evidence.requests.push({
					turn: active,
					messages: body.messages?.length,
					bytes: Buffer.byteLength(serialized),
					hasOriginal: serialized.includes(labels.original),
					hasCurrent: serialized.includes(labels.current),
					hasOther: serialized.includes(labels.other),
					at: new Date().toISOString()
				})
			}
			return handler(request)
		}
	})
	fixture = await taskServiceFixture(database, owner, intentId, { artifacts: true })
	const f = fixture,
		wiring = f.background()
	assert.equal((await f.admission.progress(randomUUID())).status, 404)
	assert.equal((await f.admission.progress('not-a-turn')).status, 400)
	assert.equal((await f.admission.progress(randomUUID() + '?owner=other')).status, 400)
	// A different member of this same environment must not see another subject's
	// runs. Merely testing a nonmember would exercise only the facade, not SQL ownership.
	const otherMember = randomUUID()
	await f.admission.control.query(
		`INSERT INTO customer_environment_memberships(environment_id,subject_id,role) VALUES($1,$2,'member')`,
		[f.environmentId, otherMember]
	)
	await f.store.update(owner, intentId, {
		expectedVersion: (await f.store.detail(owner, intentId)).version,
		clearDeadline: false,
		title: 'Fictional kite exhibition'
	})
	const work = new RemoteIntentWork(async (_method, path, body) => {
		const response = await f.admission.request(path, body),
			value = await response.json()
		if (!response.ok) throw new IntentWorkRequestError(value.message, value.code, response.status)
		return value
	})
	const artifacts = new StudioArtifacts(f.seedArtifacts!, f.environmentId)
	const installations = new TrustedActorInstallations()
	await installMarkdownRuntimeActor(installations)
	const catalog = createDocumentCatalogSource(f.environmentId, installations, [
		createMarkdownRuntimeFactory(artifacts).offer
	])
	const host = createBackgroundChatHost(
		{ ...wiring.config, modelId: 'proof-qwen', engineDigest: digest },
		{ environmentId: f.environmentId, generation: 1, worker: f.workerPool },
		{
			...wiring.pools,
			runner: () => runner!,
			catalog,
			installations,
			model: new HttpLlmGatewayClient({
				baseUrl: server.url.origin + '/internal/v1/llm',
				bearerToken: token
			})
		}
	)
	const openWorkers = () => {
		runner = new SqlPlanRunner(
			f.actorPool,
			f.workerPool,
			createChatTurnExecutor(host),
			true,
			180_000,
			4,
			(record) => host.ready(record),
			(record) => (record.skillRef === CHAT_TURN_SKILL ? digest : undefined)
		)
		f.installRunner(() => runner!)
		runtime = createIntentTurnRuntime(wiring.config, wiring.intentPools)
		recovery = new ActorRecoveryWorker({
			placements: f.actorPlacementClient,
			recover: async (placement) => {
				assert.equal(placement.environmentId, f.environmentId)
				await wiring.pools.pools.forPlacement(placement)
				await wiring.pools.workerPools.forPlacement(placement)
				await runner!.recoverAcceptedRuns()
			}
		})
		runtime.start()
		recovery.start()
	}
	const closeWorkers = async () => {
		await runtime?.close()
		await recovery?.close()
		await runner?.close()
	}
	openWorkers()
	async function exchange(
		label: string,
		text: string,
		target: InputAdmission['target'] = { kind: 'existing', id: intentId },
		locale = 'en-GB'
	) {
		active = label
		const began = performance.now()
		const decision = await gateway.inputDecision(
			{
				kind: 'route',
				modelId: 'proof-qwen',
				locale,
				text,
				context: {
					selectedId: target.kind === 'existing' ? target.id : intentId,
					intents: [{ id: intentId, title: 'Fictional kite exhibition' }],
					recent: []
				}
			},
			owner
		)
		evidence.routes.push({ label, decision })
		const admission = await work.admit({
			inputId: randomUUID(),
			revision: 1,
			text,
			originalText: text,
			corrections: [],
			target,
			locale,
			timezone: 'Europe/London',
			capturedAt: new Date().toISOString(),
			decisionId: randomUUID(),
			confirmed: true,
			responseMode: (decision.decision as InputRoute).responseMode,
			references: []
		})
		const deadline = Date.now() + 240_000
		const reserved = (await work.turns(admission.intentId)).turns.find(
			(turn) => turn.turnId === admission.turnId
		)!.responseId
		let lastProgress: TurnProgress | null = null
		while (Date.now() < deadline) {
			const response = await f.admission.progress(admission.turnId)
			if (response.status !== 404) {
				assert.equal(response.status, 200)
				const progress = turnProgressSchema.parse(await response.json())
				assert.equal(progress.turnId, admission.turnId)
				assert(Buffer.byteLength(JSON.stringify(progress)) < 16_384)
				if (lastProgress) assert(progress.revision >= lastProgress.revision)
				if (progress.revision !== lastProgress?.revision)
					evidence.progress.push({ label, ...progress })
				lastProgress = progress
			}
			const state = (await work.turns(admission.intentId)).turns.find(
				(turn) => turn.turnId === admission.turnId
			)!
			if (['failed', 'blocked', 'cancelled'].includes(state.state))
				throw Error(JSON.stringify(state))
			if (state.state === 'completed') {
				assert.equal((await f.admission.progress(admission.turnId, otherMember)).status, 404)
				assert.equal(state.responseId, reserved)
				assert.equal(state.outputContributionId, reserved)
				const answer = (await f.store.detail(owner, admission.intentId)).contributions.find(
					(c) => c.id === state.outputContributionId
				)!
				assert(answer?.text)
				evidence.answers.push({
					label,
					text,
					admission,
					answer,
					durationMs: performance.now() - began
				})
				await save()
				const failedCalls = ((answer.payload.toolCalls as any[]) ?? []).filter(
					(call) => call.status === 'failed'
				)
				if (failedCalls.length) evidence.qualityFailures.push({ label, failedCalls })
				console.log(
					JSON.stringify({ label, durationMs: performance.now() - began, answerId: answer.id })
				)
				return answer
			}
			await Bun.sleep(300)
		}
		throw Error('Conversation did not publish: ' + label)
	}
	await exchange(
		'initial',
		`Let’s discuss a fictional kite exhibition. Its reference label is ${labels.original}, and the rehearsal day is Tuesday. These are planning decisions only. Do not create tasks, files or a Skill. Acknowledge briefly.`
	)
	await exchange(
		'separate',
		`In this separate fictional puppet exhibition, the reference label is ${labels.other} and rehearsal is on Sunday. Do not apply those details to any other project. Briefly acknowledge; no tasks or files.`,
		{ kind: 'new', title: 'Fictional puppet exhibition' }
	)
	await exchange(
		'correction',
		`Correction to this kite exhibition: replace the earlier reference label with ${labels.current}. The rehearsal is Friday, not Tuesday. The old label is invalid. Please acknowledge without taking any other action.`
	)
	const discussion = [
		'Would a simple entrance sketch help visitors? Give one benefit and one drawback.',
		'Keep it a paper sketch then. What makes its legend readable?',
		'Lieber große Symbole statt winziger Schrift. Was wäre ein sinnvoller nächster Entwurfsschritt? Nur beraten.',
		'No actual drawing yet. Compare a circular display layout with a straight aisle in two sentences.',
		'Let’s tentatively choose the straight aisle. How can it still feel inviting?',
		'¿Cómo explicarías a principiantes que algunas cometas son frágiles? Una frase amable.',
		'Could volunteers demonstrate tying a basic knot without letting visitors handle the display pieces?',
		'What should we ask a venue before assuming there is room for that demonstration?',
		'I worry about noise. Is a quiet demonstration corner a reasonable compromise?',
		'Bitte unterscheide Annahme und Entscheidung in unserem letzten Vorschlag. Kurz bleiben.',
		'We have not booked any venue. What wording avoids implying that we have?',
		'What would be a clear label for a kite made by several people together?',
		'Could a tactile sample be separate from the actual exhibit? Mention one caveat.',
		'What question would help us check whether those samples are useful rather than decorative?',
		'No survey yet, just planning. Compare asking one open question with a rating scale.',
		'Vale, prefiero una pregunta abierta. ¿Cómo evitarías que sugiera una respuesta concreta?',
		'How might we accommodate visitors who want to look without joining an activity?',
		'Would a short volunteer briefing help keep those choices consistent?',
		'What belongs in that briefing, and what should stay out? Two points only.',
		'No briefing document yet. What is the risk of giving every volunteer too much background?',
		'Wie würden wir eine beschädigte Musterleine behandeln? Bitte nur eine vorsichtige Empfehlung.',
		'Assume no one has inspected the samples yet. Do not describe them as safe. What wording fits?',
		'What is a simple way to distinguish things still under discussion from agreed display choices?',
		'We do not need software for that yet. Suggest a low-tech approach.',
		'Could we revisit the aisle decision later without rewriting all of the earlier notes?',
		'What should the next planning conversation clarify? Avoid claiming anything has been arranged.'
	]
	for (let i = 0; i < discussion.length; i++) {
		await exchange(`discussion-${i + 1}`, discussion[i])
		if (i === 12) {
			const before = (await f.store.detail(owner, intentId)).contributions
			await closeWorkers()
			openWorkers()
			assert.deepEqual((await f.store.detail(owner, intentId)).contributions, before)
			evidence.reconstructedAfter = i + 1
		}
	}
	const recalled = await exchange(
		'recall',
		'Back to the early decisions in THIS kite exhibition: what is the current exact reference label, and which weekday did we finally choose for the rehearsal? Use the saved conversation if they are no longer in recent context. Do not substitute the puppet project, guess a code, or create anything. Two short lines please.'
	)
	const recallRequests = evidence.requests.filter((entry: any) => entry.turn === 'recall')
	assert(recallRequests.length)
	assert.equal(
		recallRequests[0].hasCurrent,
		false,
		'The regression must actually require information outside the recent model window.'
	)
	assert(recalled.text!.includes(labels.current))
	assert.match(recalled.text!, /Friday|Freitag|viernes/i)
	assert(!recalled.text!.includes(labels.other))
	const calls = (recalled.payload.toolCalls as any[]) ?? []
	assert(
		calls.some((call) => {
			if (call.name !== 'workspace_read' && call.name !== 'workspace_search') return false
			const result = JSON.parse(call.result)
			const correctionId = evidence.answers.find((entry: any) => entry.label === 'correction')
				.admission.contributionId
			const sources = call.name === 'workspace_read' ? [result] : (result.messages ?? [])
			return sources.some(
				(source: any) => source.sourceId === correctionId && source.content.includes(labels.current)
			)
		}),
		'The model must retrieve the exact saved correction under its source identity.'
	)
	assert.equal((await f.repository().list(owner, {})).tasks.length, 0)
	// Detail intentionally returns only recent contributions. Exhaust the owned
	// chronological message API before asserting complete saved-history coverage.
	const finalIds = new Set<string>()
	let cursor: string | undefined
	do {
		const page = await f.store.messages(owner, {
			intent: intentId,
			role: 'assistant',
			order: 'oldest',
			limit: 20,
			cursor
		})
		for (const message of page.messages) {
			assert(!finalIds.has(message.id), 'History pagination repeated a saved response.')
			finalIds.add(message.id)
		}
		cursor = page.nextCursor ?? undefined
		assert.equal(page.hasMore, Boolean(cursor))
	} while (cursor)
	assert.deepEqual(
		[...finalIds].sort(),
		evidence.answers
			.filter((entry: any) => entry.admission.intentId === intentId)
			.map((entry: any) => entry.answer.id)
			.sort()
	)
	assert.equal(finalIds.size, discussion.length + 3)
	assert(
		evidence.progress.some(
			(p: TurnProgress) => p.operation?.kind === 'model' && p.operation.state === 'running'
		)
	)
	assert(
		evidence.progress.some((p: TurnProgress) =>
			p.steps.some((s) => s.kind === 'tool' && s.state === 'completed')
		)
	)
	assert(evidence.progress.some((p: TurnProgress) => p.steps.some((s) => (s.durationMs ?? 0) > 0)))
	evidence.checks = {
		boundedOwnedProgress: true,
		liveModelAndCompletedToolTiming: true,
		rollingContextExceeded: true,
		retrievedCurrentCorrection: true,
		separateIntentNotSubstituted: true,
		noUnrequestedTasks: true,
		realSequentialAnswers: evidence.answers.length
	}
	assert.equal(
		evidence.qualityFailures.length,
		0,
		'Recovered tool failures still fail first-attempt quality; other boundary checks are retained independently.'
	)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	if (fixture)
		evidence.failedRuns = (
			await fixture.pool.query('SELECT id,state,record FROM aven_actor_runs.runs')
		).rows
	throw error
} finally {
	await runtime?.close()
	await recovery?.close()
	await runner?.close()
	await fixture?.close()
	await server?.stop(true)
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(JSON.stringify({ evidence: `${directory}/evidence.json`, passed: evidence.passed }))
}
