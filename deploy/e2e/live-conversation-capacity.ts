/** Rolling-history boundaries and a real provider overflow during queued work. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createCalculationActor } from '../../libs/aven-actors/src/calculation'
import { ChatCore, type Turn } from '../../libs/aven-chat-engine/src/chat'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import { modelMetricsFromPayload } from '../../libs/aven-chat-engine/src/model-metrics'
import type { ToolCall } from '../../libs/aven-chat-engine/src/tool-call'
import { turnPayload } from '../../libs/aven-chat-engine/src/turn-payload'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
assert(base, 'Configure a trusted live Qwen server; this test has no model substitute')
const descriptor = (await fetch(base + '/models').then((r) => r.json())).data.find((m: any) =>
	process.env.LIVE_LLM_MODEL ? m.id === process.env.LIVE_LLM_MODEL : /qwen/i.test(m.id)
)
assert(descriptor && Number.isSafeInteger(descriptor.max_model_len))
const model = descriptor.id,
	capacity = descriptor.max_model_len
const directory = await mkdtemp('/tmp/aven-live-conversation-capacity-')
const evidence: any = {
	synthetic: true,
	model,
	capacity,
	passed: false,
	runs: [],
	fingerprints: {},
	scope:
		'Production ChatCore, gateway, real calculator and Qwen; restored histories and queued submissions. No canned model/tool outputs. Persistence callback is observed in memory, not a database/native restart guarantee.'
}
for (const path of [
	'deploy/e2e/live-conversation-capacity.ts',
	'libs/aven-chat-engine/src/chat.ts',
	'libs/aven-chat-engine/src/model-metrics.ts',
	'libs/aven-chat-engine/src/turn-payload.ts',
	'libs/aven-chat-engine/src/history-selection.ts',
	'services/aven-api/src/lib/server/model-observation.ts'
])
	evidence.fingerprints[path] = createHash('sha256')
		.update(await readFile(new URL('../../' + path, import.meta.url)))
		.digest('hex')
console.log(directory)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_TIMEOUT_SECONDS: '180',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'capacity-qwen',
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
async function tokens(messages: Array<{ role: string; content: string }>): Promise<number> {
	const response = await fetch(base + '/tokenize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			messages: messages.map(({ role, content }) => ({ role, content })),
			chat_template_kwargs: { enable_thinking: false }
		}),
		signal: AbortSignal.timeout(60_000)
	})
	assert(response.ok)
	const result = await response.json()
	assert(Number.isSafeInteger(result.count))
	return result.count
}
let requests: Array<{ messages: number; bytes: number; failed?: string }> = []
let dispatched: (() => void) | undefined
const stream = createGatewayModelStream({
	request: (input) =>
		chatGatewayRequest({ ...input, model: 'capacity-qwen', thinking: false }, 4096),
	open: async function* (request, signal) {
		const entry = {
			messages: request.messages.length,
			bytes: JSON.stringify(request).length
		} as (typeof requests)[number]
		requests.push(entry)
		dispatched?.()
		dispatched = undefined
		try {
			const response = await gateway.openAiChatCompletion(request, signal)
			const decoder = new TextDecoder()
			for await (const value of response.body!) yield decoder.decode(value, { stream: true })
			yield decoder.decode()
		} catch (error) {
			entry.failed = (error as any).code
			throw error
		}
	}
})
const filler =
	'Fictional packing note: a wooden moon belongs in an empty cabinet; no item was dispatched.\n'
try {
	for (const count of [23, 24, 25, 120]) {
		requests = []
		const history: Turn[] = Array.from({ length: count }, (_, i) => ({
			id: crypto.randomUUID(),
			role: i % 2 ? 'assistant' : 'user',
			persisted: true,
			content:
				i === count - 2
					? 'Correction: the fictional gallery rehearsal is on Saturday, not Wednesday.'
					: i === count - 1
						? 'The current rehearsal day is Saturday; this is only a plan.'
						: `Imaginary conversation entry ${i + 1}. ` + filler.repeat(count === 120 ? 150 : 2)
		}))
		// Keep the correction human-authored regardless of boundary parity.
		history[count - 2].role = 'user'
		history[count - 1].role = 'assistant'
		const originalTokens = await tokens(history)
		if (count === 120)
			assert(
				originalTokens > capacity,
				'Long stored history must exceed the actual provider window'
			)
		const chat = new ChatCore(
			{},
			{
				specs: [],
				run: () => {
					throw Error('No external action was requested')
				}
			},
			stream
		)
		chat.use('synthetic-history-' + count)
		chat.hydrate(chat.session, history)
		const began = performance.now()
		await chat.send(
			count % 2
				? 'Welcher Tag gilt nach meiner Korrektur für die Probe? Nur der Wochentag bitte.'
				: 'After my correction, what is the rehearsal day? Just the weekday please.'
		)
		const answer = chat.turns.at(-1)!.content
		const modelRequests = modelMetricsFromPayload(turnPayload(chat.turns.at(-1)!))
		const reportedUsage = chat.diagnostics
			.filter((event) => event.reason === 'usage')
			.map((event) => event.usage)
		const run = {
			name: `recent-history-${count}`,
			originalTokens,
			answer,
			durationMs: performance.now() - began,
			failure: chat.failure,
			requests,
			calls: chat.toolCalls,
			reportedUsage,
			modelRequests,
			passed:
				!chat.failure &&
				modelRequests.length === requests.length &&
				modelRequests.every(
					(request) =>
						request.status === 'completed' &&
						request.durationMs! > 0 &&
						request.firstTextMs !== undefined &&
						request.inputTokens! > 0 &&
						request.outputTokens! > 0
				) &&
				chat.toolCalls.every((call) => call.status === 'completed') &&
				/Saturday|Samstag/i.test(answer) &&
				reportedUsage.length > 0 &&
				reportedUsage.every(
					(usage) =>
						Number.isSafeInteger(usage?.prompt_tokens) &&
						Number(usage?.prompt_tokens) > 0 &&
						Number.isSafeInteger(usage?.completion_tokens) &&
						Number(usage?.completion_tokens) > 0
				) &&
				requests.every((r) => r.bytes < 100_000)
		}
		evidence.runs.push(run)
		await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
		console.log(JSON.stringify(run))
	}

	// A completed calculation belongs to the admitted turn before the model sees
	// an oversized host context. Its real receipt must survive the failed answer.
	const calculator = createCalculationActor()
	try {
		let executions = 0
		const args = {
			operation: 'multiply',
			operands: [
				{ value: '7', unit: 'quantity:boxes', label: 'boxes per shelf' },
				{ value: '4', unit: '1', label: 'shelves' }
			],
			purpose: 'Fictional storage capacity'
		}
		const calculationBegan = performance.now()
		const result = await calculator.deliver('calculate', args)
		executions++
		const receipt: ToolCall = {
			id: crypto.randomUUID(),
			name: 'calculate',
			arguments: JSON.stringify(args),
			status: 'completed',
			result: result.record,
			durationMs: performance.now() - calculationBegan
		}
		assert.equal(JSON.parse(receipt.result).outputs.calculation.result.value, '28')
		const context = filler.repeat(Math.ceil(capacity / 12))
		const oversizedTokens = await tokens([
			{ role: 'system', content: context },
			{ role: 'user', content: 'Report the fictional result.' }
		])
		assert(oversizedTokens > capacity)
		const settled: any[] = []
		const chat = new ChatCore(
			{},
			{
				specs: calculator.manifest.methods,
				run: (name, args) => {
					executions++
					return calculator.deliver(name, JSON.parse(args))
				}
			},
			stream
		)
		chat.use('synthetic-overflow-recovery')
		chat.onExchange = (_key, user, reply) => settled.push(structuredClone({ user, reply }))
		requests = []
		const started = new Promise<void>((resolve) => {
			dispatched = resolve
		})
		const prompt = 'Report the already completed fictional calculation; do not execute it again.'
		const user: Turn = { id: crypto.randomUUID(), role: 'user', content: prompt }
		const first = chat.send(prompt, undefined, { user, context, calls: [receipt] })
		await Promise.race([
			started,
			first.then(() => {
				throw Error('The oversized turn ended before provider dispatch')
			})
		])
		const secondText =
			'Set the oversized background aside. Do not repeat any calculation. Reply with exactly READY.'
		const second = chat.send(secondText)
		await Promise.all([first, second])
		const run = {
			name: 'overflow-preserves-receipt-and-queue',
			oversizedTokens,
			requests,
			executions,
			settled,
			passed:
				requests.filter((r) => r.failed === 'LLM_CONTEXT_LIMIT').length === 1 &&
				executions === 1 &&
				settled.length === 2 &&
				settled[0].user.content === prompt &&
				settled[0].reply.calls?.[0]?.result === receipt.result &&
				settled[0].reply.content.includes('context limit') &&
				modelMetricsFromPayload(turnPayload(settled[0].reply)).every(
					(m) =>
						m.status === 'failed' && m.inputTokens === undefined && m.outputTokens === undefined
				) &&
				modelMetricsFromPayload(turnPayload(settled[0].reply)).length === 1 &&
				settled[1].user.content === secondText &&
				settled[1].reply.content.trim() === 'READY' &&
				modelMetricsFromPayload(turnPayload(settled[1].reply)).every(
					(m) => m.status === 'completed' && m.inputTokens! > 0 && m.outputTokens! > 0
				) &&
				!chat.failure
		}
		evidence.runs.push(run)
		console.log(
			JSON.stringify({
				...run,
				settled: settled.map((s) => ({ user: s.user.content, reply: s.reply.content }))
			})
		)
	} finally {
		calculator.dispose()
	}
	// Cancel an actual generation, then continue in the same Intent. Do not let
	// late cleanup rewrite the next response's phase/usage or its saved payload.
	{
		const settled: any[] = []
		let interrupted = false
		const chat = new ChatCore(
			{
				onDelta: () => {
					if (!interrupted) {
						interrupted = true
						chat.stop()
					}
				}
			},
			{
				specs: [],
				run: () => {
					throw Error('No tool requested')
				}
			},
			stream
		)
		chat.use('synthetic-interruption-metrics')
		chat.onExchange = (_key, user, reply) =>
			settled.push({
				user: user.content,
				content: reply.content,
				payload: turnPayload(reply)
			})
		await chat.send(
			'Write an 800-word fictional story about a lighthouse painted green. Start telling the story immediately.'
		)
		assert(interrupted, 'Cancellation must follow real generated text')
		await chat.send('Stop the story. Reply with exactly READY.')
		const first = modelMetricsFromPayload(settled[0]?.payload ?? {})
		const next = modelMetricsFromPayload(settled[1]?.payload ?? {})
		const run = {
			name: 'interrupted-model-observation-does-not-leak-to-continuation',
			settled,
			passed:
				settled.length === 2 &&
				first.length > 0 &&
				next.length > 0 &&
				first.at(-1)?.status === 'interrupted' &&
				next.every(
					(m) =>
						m.status === 'completed' &&
						m.inputTokens! > 0 &&
						m.outputTokens! > 0 &&
						!first.some((old) => old.id === m.id)
				) &&
				settled[1].content.trim() === 'READY' &&
				!chat.failure
		}
		evidence.runs.push(run)
		console.log(JSON.stringify(run))
	}
	evidence.passed = evidence.runs.every((run: any) => run.passed)
	assert(evidence.passed, 'Retain and inspect any failed live conversation boundary.')
} finally {
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
}
