/** Independently invented conversations, real Qwen, production task HTTP service and PostgreSQL.
 * A transport gate controls arrival order only: no model/tool answer is mocked. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { ChatCore, type Turn } from '@avenos/chat-engine/chat'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import type { ModelStream } from '@avenos/chat-engine/model'
import {
	callsFromPayload,
	responseInputsFromPayload,
	turnPayload
} from '@avenos/chat-engine/turn-payload'
import { createTaskActor, TASK_MANIFEST } from '@avenos/productivity/actor'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'

const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, ''),
	database = process.env.TEST_TASK_DATABASE_URL
assert(
	base && database,
	'Use a real Qwen endpoint and a disposable PostgreSQL server, never a customer cluster.'
)
const models = await fetch(`${base}/models`, { signal: AbortSignal.timeout(10_000) }).then(
	async (response) => {
		assert(response.ok)
		return response.json()
	}
)
const model =
	process.env.LIVE_LLM_MODEL ??
	models.data.find((entry: { id: string }) => /qwen/i.test(entry.id))?.id
assert(model && /qwen/i.test(model), 'Qwen is required for this proof.')
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'continuity-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const output = await mkdtemp('/tmp/aven-live-queued-continuity-')
const evidence: any = {
	synthetic: true,
	model,
	passed: false,
	startedAt: new Date().toISOString(),
	cases: [],
	fingerprints: {},
	scope:
		'Foreground shared Chat engine, real Qwen gateway/stream, actual Task Actor, provisioned restricted SQL roles and task HTTP service, saved contributions and reload. Not native microphone/router, durable outbox coalescing or proof of speech endpointing.'
}
for (const path of [
	'deploy/e2e/live-queued-continuity.ts',
	'deploy/e2e/task-service-fixture.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/queued-inputs.ts',
	'libs/aven-chat-engine/src/turn-payload.ts',
	'libs/aven-chat-engine/src/restored-history.ts',
	'libs/aven-chat-engine/src/gateway.ts',
	'libs/aven-productivity/src/actor.ts',
	'libs/aven-productivity/src/postgres.ts',
	'services/intent-service/src/store.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(path))
		.digest('hex')
const save = () =>
	writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const upstream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'continuity-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body, `Gateway returned ${response.status}`)
		const decoder = new TextDecoder()
		for await (const chunk of response.body!) yield decoder.decode(chunk, { stream: true })
		yield decoder.decode()
	}
})

const scenarios = [
	{
		id: 'fragment-completed',
		messages: ['Please save a task to', 'refill the blue bird feeder. Use exactly that title.'],
		titles: ['refill the blue bird feeder'],
		clarifyFirst: true
	},
	{
		id: 'correction',
		messages: [
			'Save a task named "Order crimson yarn".',
			'Actually, ochre yarn, not crimson. Only the corrected task please.'
		],
		titles: ['Order ochre yarn']
	},
	{
		id: 'withdraw-before-dispatch',
		messages: [
			'Add "Book the puppet theatre" to my tasks.',
			'Wait, don’t save any task. Just give me a short draft title here.'
		],
		titles: []
	},
	{
		id: 'two-outcomes',
		messages: [
			'Create a task called "Check the compost thermometer".',
			'And another called "Wash the seed trays". Both belong on my list.'
		],
		titles: ['Check the compost thermometer', 'Wash the seed trays']
	},
	{
		id: 'informal-german',
		messages: [
			'setz mal ne aufgabe auf die liste',
			'äh titel "Fahrradklingel testen". kein termin nötig, bitte einfach speichern'
		],
		titles: ['Fahrradklingel testen'],
		clarifyFirst: true
	},
	{
		id: 'mixed-language',
		messages: [
			'Please save "Reserve the pottery wheel" as a task.',
			'Nicht reservieren, erstmal nur Verfügbarkeit prüfen. Nenn die Aufgabe genau "Check pottery wheel availability".'
		],
		titles: ['Check pottery wheel availability']
	},
	{
		id: 'planning-not-task-work',
		messages: [
			'For a beginner ceramics session, suggest one gentle activity.',
			'No spinning wheel, and nothing that needs firing. We are indoors.'
		],
		titles: []
	},
	{
		id: 'still-incomplete',
		messages: ['Please create a task for', 'the thing I have not described yet.'],
		titles: [],
		question: true
	}
]
const owner = randomUUID()
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined
try {
	fixture = await taskServiceFixture(database, owner, randomUUID())
	const repository = fixture.repository()
	for (const scenario of scenarios) {
		const intentId = randomUUID(),
			started = performance.now(),
			calls: any[] = [],
			modelCalls: any[] = [],
			writes: Promise<unknown>[] = []
		const report: any = {
			id: scenario.id,
			messages: scenario.messages,
			expectedTitles: scenario.titles,
			calls,
			modelCalls,
			passed: false
		}
		evidence.cases.push(report)
		await fixture.store.create(owner, {
			id: intentId,
			title: `Synthetic ${scenario.id}`,
			intentType: 'conversation',
			sourceLabel: 'Synthetic proof',
			deadline: null
		})
		const entered = Promise.withResolvers<void>(),
			release = Promise.withResolvers<void>()
		let first = true
		const stream: ModelStream = async function* (...args) {
			if (first) {
				first = false
				entered.resolve()
				await release.promise
			}
			const at = performance.now(),
				entry: any = {
					phase: args[4]?.phase ?? 'answer',
					users: args[0].filter((m) => m.role === 'user').map((m) => m.content)
				}
			modelCalls.push(entry)
			try {
				yield* upstream(...args)
			} finally {
				entry.durationMs = performance.now() - at
			}
		}
		const specs = TASK_MANIFEST.methods.map(({ name, description, parameters }) => ({
			name,
			description,
			parameters
		}))
		const chat = new ChatCore(
			{},
			{
				specs,
				run: async (name, args) => {
					const actor = createTaskActor(repository, () => ({
						ownerSubjectId: owner,
						operationId: randomUUID(),
						intentId,
						contributionId: chat.activeUserId
					}))
					try {
						const result = await actor.deliver(name, JSON.parse(args))
						calls.push({ name, arguments: JSON.parse(args), result: JSON.parse(result.record) })
						return result
					} finally {
						actor.dispose()
					}
				}
			},
			stream
		)
		chat.use(intentId)
		chat.context = () =>
			`Accepted Intent ${intentId}. A synthetic private task conversation. Use the saved task Actor when a task is requested.`
		chat.onExchange = (session, _user, assistant, inputs) => {
			assert.equal(session, intentId)
			assert.deepEqual(
				assistant.inReplyTo,
				inputs.map((input) => input.id)
			)
			writes.push(
				fixture!.store.append(owner, session, {
					id: assistant.id,
					contributorKind: 'agent',
					kind: 'message',
					text: assistant.content,
					payload: turnPayload(assistant)
				})
			)
		}
		async function admit(text: string, clarify = false) {
			const user: Turn = {
				id: randomUUID(),
				role: 'user',
				content: text,
				queued: true,
				persisted: true,
				inputAdmission: {
					intentId,
					destination: 'existing',
					confirmed: false,
					responseMode: clarify ? 'clarify' : 'work'
				}
			}
			await fixture!.store.append(owner, intentId, {
				id: user.id,
				contributorKind: 'human',
				kind: 'message',
				text,
				payload: turnPayload(user)
			})
			// Return an object so admission does not await execution: this is the foreground host's contract.
			return {
				user,
				execution: chat.send(text, undefined, { user, context: chat.context!(), calls: [] })
			}
		}
		const primer = await admit('For now, only reply "Ready". Do not perform any action.')
		await entered.promise
		const queued: Awaited<ReturnType<typeof admit>>[] = []
		for (const [index, text] of scenario.messages.entries())
			queued.push(await admit(text, index === 0 && scenario.clarifyFirst))
		assert(
			queued.every((item) => item.user.queued),
			'Messages must really be queued behind a running model request.'
		)
		release.resolve()
		await Promise.all([primer.execution, ...queued.map((item) => item.execution)])
		await Promise.all(writes)
		const replies = chat.turns.filter((turn) => turn.role === 'assistant')
		report.replies = replies
		report.diagnostics = chat.diagnostics
		assert.equal(chat.failure, null)
		assert.equal(
			replies.length,
			2,
			'One primer answer and one answer to the already waiting group.'
		)
		assert.deepEqual(
			replies[1].inReplyTo,
			queued.map((item) => item.user.id)
		)
		assert.deepEqual(
			chat.turns.filter((turn) => turn.role === 'user').map((turn) => turn.content),
			[primer.user.content, ...scenario.messages]
		)
		assert(
			queued.every((item) => !item.user.queued),
			'No grouped message may remain visibly queued.'
		)
		assert(replies[1].content.trim())
		assert.equal(
			replies[1].content.includes('?'),
			scenario.question ?? false,
			'Only the still-incomplete request should need a clarification.'
		)
		assert(
			calls.every((call) => call.result.ok),
			'No avoidable failed tool calls.'
		)
		const page = await repository.list(owner, { intentId, limit: 100 })
		assert(page.complete)
		assert.deepEqual(
			page.tasks.map((task) => task.title).sort(),
			[...scenario.titles].sort(),
			'Only the final requested outcomes should have been saved.'
		)
		assert(
			page.tasks.every((task) => task.revision === 1),
			'A superseded queued request must not be executed and then repaired.'
		)
		const saved = await fixture.store.detail(owner, intentId)
		assert(!saved.contributionsHasMore)
		const history: Turn[] = saved.contributions
			.filter((c) => c.kind === 'message' && ['human', 'agent'].includes(c.contributorKind))
			.map((c) => ({
				id: c.id,
				role: c.contributorKind === 'human' ? 'user' : 'assistant',
				content: c.text ?? '',
				calls: callsFromPayload(c.payload),
				inReplyTo: responseInputsFromPayload(c.payload)
			}))
		assert.deepEqual(
			history.filter((t) => t.role === 'user').map((t) => t.content),
			[primer.user.content, ...scenario.messages]
		)
		assert.deepEqual(
			history.at(-1)?.inReplyTo,
			queued.map((item) => item.user.id)
		)
		report.savedHistory = history
		const before = calls.length
		const restored = new ChatCore(
			{},
			{
				specs,
				run: async (name, args) => {
					const actor = createTaskActor(repository, () => ({
						ownerSubjectId: owner,
						operationId: randomUUID(),
						intentId,
						contributionId: null
					}))
					try {
						const result = await actor.deliver(name, JSON.parse(args))
						calls.push({ name, arguments: JSON.parse(args), result: JSON.parse(result.record) })
						return result
					} finally {
						actor.dispose()
					}
				}
			},
			stream
		)
		restored.hydrate(intentId, history)
		restored.use(intentId)
		restored.context = chat.context
		await restored.send(
			'In one sentence, what did my last request result in? Do not change anything.'
		)
		assert.equal(restored.failure, null)
		assert(
			calls.slice(before).every((call) => call.name === 'todo_list'),
			'Reload and a status question must not repeat a mutation.'
		)
		report.reloadReply = restored.turns.at(-1)?.content
		report.tasks = page.tasks
		report.durationMs = performance.now() - started
		report.passed = true
		chat.resetForEnvironment()
		restored.resetForEnvironment()
		await save()
		console.log(
			JSON.stringify({
				case: scenario.id,
				passed: true,
				durationMs: report.durationMs,
				reply: replies[1].content
			})
		)
	}
	// Real-model dispatch checks for boundaries and cleanup, separate from semantic scenarios.
	const batches = new ChatCore({}, undefined, upstream)
	batches.use(randomUUID())
	await Promise.all(
		Array.from({ length: 20 }, (_, index) =>
			batches.send(
				`Queue test note ${String.fromCharCode(65 + index)}: acknowledge briefly in chat only; no saved changes.`
			)
		)
	)
	assert.equal(batches.failure, null)
	assert.deepEqual(
		batches.turns.filter((t) => t.role === 'assistant').map((t) => t.inReplyTo?.length),
		[16, 4]
	)
	assert(batches.turns.every((t) => !t.queued && !t.pending))
	evidence.boundedDispatch = {
		groups: [16, 4],
		replies: batches.turns.filter((t) => t.role === 'assistant')
	}
	batches.resetForEnvironment()
	assert.equal(batches.turns.length, 0)
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const gated: ModelStream = async function* (...args) {
		entered.resolve()
		await release.promise
		yield* upstream(...args)
	}
	const busy = new ChatCore({}, undefined, gated),
		independent = new ChatCore({}, undefined, upstream)
	busy.use(randomUUID())
	independent.use(randomUUID())
	const running = busy.send('Reply only with "Amber".')
	await entered.promise
	await independent.send('Reply only with "Violet".')
	assert.equal(independent.failure, null)
	assert(independent.turns.at(-1)?.content.includes('Violet'))
	assert(busy.streaming, 'An independent Intent must complete while the other is still waiting.')
	// Reset while transport is held: it must not resurrect old inputs or publish a late result.
	const waiting = busy.send('This is a waiting message that must not survive an environment reset.')
	busy.resetForEnvironment()
	release.resolve()
	await Promise.all([running, waiting])
	assert.equal(busy.turns.length, 0)
	evidence.independentAndReset = {
		independentReply: independent.turns.at(-1),
		noResurrectedInput: true
	}
	independent.resetForEnvironment()
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await fixture?.close()
	evidence.finishedAt = new Date().toISOString()
	await save()
	console.log(`Evidence: ${output}/evidence.json`)
}
