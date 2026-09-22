/** Real conditional-write conflicts, signed HTTP, SQL and Qwen. Synthetic data only. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { ChatCore } from '@avenos/chat-engine/chat'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import { runIntentCommand } from '../../app/src/lib/intents/command-result'
import { Actor } from '../../libs/aven-actors/src/actor'
import { createRetrievalActor } from '../../libs/aven-actors/src/retrieval'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { taskServiceFixture } from './task-service-fixture'

const base = process.env.LIVE_LLM_BASE_URL,
	database = process.env.TEST_TASK_DATABASE_URL
assert(base && database, 'Trusted Qwen and a disposable PostgreSQL cluster are required.')
const model = (await fetch(base + '/models').then((r) => r.json())).data.find((m: any) =>
	/qwen/i.test(m.id)
)?.id
assert(model)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'conflict-qwen',
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
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'conflict-qwen' }),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		for await (const bytes of response.body!) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
})
const directory = await mkdtemp('/tmp/aven-live-intent-conflict-')
console.log(directory)
const evidence: any = {
	synthetic: true,
	model,
	passed: false,
	runs: [],
	scope:
		'Shared command rejection adapter and conversation engine, real Qwen, authenticated facade/Intent Service and restricted SQL. Not native UI or a lost-acknowledgement retry guarantee.'
}
const owner = randomUUID(),
	intentId = randomUUID()
let fixture: Awaited<ReturnType<typeof taskServiceFixture>> | undefined
let chat: ChatCore | undefined
let actor: Actor | undefined
let reader: Actor | undefined
try {
	fixture = await taskServiceFixture(database, owner, intentId)
	const read = async (path: string) => {
		const response = await fixture!.admission.request(path)
		assert(response.ok)
		const record = JSON.stringify(await response.json())
		return { record, wire: record }
	}
	reader = createRetrievalActor({
		intent_list: (args) => read('?query=' + encodeURIComponent(String(args.query ?? ''))),
		intent_detail: (args) => read('/' + encodeURIComponent(String(args.intent)) + '/preview')
	})
	for (const scenario of [
		{
			action: 'archive',
			state: 'archive',
			question:
				'Archive this fictional repair-cafe Intent now. Do not change or delete its saved notes.'
		},
		{
			action: 'restore',
			state: 'working',
			question:
				'Restaura este Intent del taller imaginario a la lista activa. Conserva todas las notas.'
		}
	]) {
		let observed = await fixture.store.detail(owner, intentId)
		// Another actual contribution invalidates the observed revision before execution.
		const note = randomUUID()
		await fixture.store.append(owner, intentId, {
			id: note,
			contributorKind: 'human',
			kind: 'message',
			text: 'Invented workshop note: keep the turquoise spool in drawer seven.',
			payload: {}
		})
		const before = await fixture.store.detail(owner, intentId)
		const attempts: any[] = []
		let refreshes = 0
		const name = 'intent_' + scenario.action
		actor = new Actor(
			{
				id: 'intents',
				authority: 'ceo.aven',
				namespace: 'intents',
				version: '1',
				name: 'Intents',
				description: 'Synthetic lifecycle conflict qualification through the real Intent Service.',
				tags: ['test'],
				methods: [
					{
						name,
						mode: 'effect',
						description: `Explicitly ${scenario.action} the current Intent without changing its notes. A version conflict means no change was applied; reconsider the current state before another command.`,
						parameters: { type: 'object', properties: {}, additionalProperties: false }
					}
				]
			},
			{
				[name]: async () => {
					const result = await runIntentCommand(
						async () => {
							const expectedVersion = observed.version
							const response = await fixture!.admission.request(`/${intentId}/${scenario.action}`, {
								id: intentId,
								expectedVersion
							})
							const value = await response.json()
							attempts.push({ expectedVersion, status: response.status, value })
							// Match the native response_error envelope from this actual HTTP reply.
							if (!response.ok)
								throw JSON.stringify({
									...value,
									status: response.status,
									retryable:
										response.status === 408 || response.status === 429 || response.status >= 500
								})
							return value
						},
						async () => {
							const response = await fixture!.admission.request('/' + intentId)
							assert(response.ok)
							observed = await response.json()
							refreshes++
						}
					)
					const record = JSON.stringify({ ok: true, state: result.state, version: result.version })
					return { record, wire: record }
				}
			}
		)
		chat = new ChatCore(
			{},
			{
				specs: [...actor.manifest.methods, ...reader.manifest.methods],
				run: (tool, args) => (tool === name ? actor! : reader!).deliver(tool, JSON.parse(args))
			},
			stream
		)
		chat.use(intentId)
		chat.context = () =>
			`Current Intent ${intentId}: a fictional repair cafe. Latest observed state: ${observed.state}, revision ${observed.version}. Use the installed tool only for the requested state change. A known rejected write can be reconsidered; never retry an unknown outcome.`
		await chat.send(scenario.question)
		const after = await fixture.store.detail(owner, intentId)
		const run = {
			scenario,
			attempts,
			refreshes,
			failure: chat.failure,
			turns: chat.turns,
			before: before.version,
			after: after.version,
			state: after.state
		}
		evidence.runs.push(run)
		assert.equal(chat.failure, null)
		const metrics = chat.turns.at(-1)?.modelRequests ?? []
		assert(metrics.some((request) => request.phase === 'answer'))
		assert(metrics.some((request) => request.phase === 'verification'))
		assert(
			metrics.every(
				(request) =>
					request.status === 'completed' &&
					request.durationMs! > 0 &&
					request.inputTokens! > 0 &&
					request.outputTokens! > 0
			)
		)
		assert.deepEqual(
			attempts.map((a) => a.status),
			[409, 200]
		)
		assert.equal(attempts[0].value.code, 'INTENT_VERSION_CONFLICT')
		assert.equal(refreshes, 1)
		assert.equal(after.state, scenario.state)
		assert.equal(after.version, before.version + 1)
		assert(after.contributions.some((c) => c.id === note))
		assert.equal(chat.turns.at(-1)?.calls?.filter((c) => c.status === 'failed').length, 1)
		assert.equal(
			chat.turns.at(-1)?.calls?.filter((c) => c.name === name && c.status === 'completed').length,
			1
		)
		actor.dispose()
		actor = undefined
	}
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	actor?.dispose()
	reader?.dispose()
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2), { mode: 0o600 })
	await fixture?.close()
}
