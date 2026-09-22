/** Actual provider-token boundaries, not character estimates or canned completions. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import {
	chatGatewayRequest,
	createGatewayModelStream
} from '../../libs/aven-chat-engine/src/gateway'
import { transportError } from '../../libs/aven-chat-engine/src/transport-error'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'
import { contextBoundary, template } from './context-boundary-fixture'

const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
assert(base, 'A trusted live Qwen endpoint with /tokenize is required; no fallback model.')
const catalog = await fetch(base + '/models').then((response) => response.json())
const descriptor = catalog.data.find((item: any) =>
	process.env.LIVE_LLM_MODEL ? item.id === process.env.LIVE_LLM_MODEL : /qwen/i.test(item.id)
)
assert(descriptor && Number.isSafeInteger(descriptor.max_model_len))
const model = descriptor.id,
	capacity = descriptor.max_model_len,
	reserve = 512
assert(capacity >= 8192 && capacity <= 1_048_576, 'Unexpected provider context capacity')
const directory = await mkdtemp('/tmp/aven-live-context-boundaries-')
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	capacity,
	outputReserve: reserve,
	startedAt: new Date().toISOString(),
	scope:
		'Real Qwen through the production gateway with tokenizer-measured, invented multi-message histories. This isolates provider-boundary behavior; it is not native UI or durable-worker proof.',
	fingerprints: {},
	runs: []
}
for (const file of [
	'deploy/e2e/live-context-boundaries.ts',
	'deploy/e2e/context-boundary-fixture.ts',
	'libs/aven-chat-engine/src/gateway.ts',
	'libs/aven-chat-engine/src/stream.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts',
	'services/aven-api/src/lib/server/model-observation.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(new URL('../../' + file, import.meta.url)))
		.digest('hex')
console.log(directory)
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MAX_PARALLELISM: '1',
		LLM_GATEWAY_TIMEOUT_SECONDS: '600',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'context-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				timeoutSeconds: 600,
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	})
)!
const atBoundary = contextBoundary(base, model, capacity)
const measured = new Map<number, Awaited<ReturnType<typeof atBoundary>>>()
const stream = createGatewayModelStream({
	request: (input) =>
		chatGatewayRequest({ ...input, model: 'context-qwen', temperature: 0 }, reserve),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.body)
		const decoder = new TextDecoder()
		for await (const bytes of response.body) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
})
try {
	for (const scenario of [
		{ name: 'near-context-limit', target: Math.floor(capacity * 0.98) - reserve },
		{ name: 'at-context-edge', target: capacity - reserve - 96 },
		{ name: 'output-reservation-overflow', target: capacity - 160, overflow: true },
		{ name: 'actual-context-overflow', target: capacity + 256, overflow: true },
		{ name: 'stream-at-context-edge', target: capacity - reserve - 96, streaming: true },
		{
			name: 'stream-output-reservation-overflow',
			target: capacity - 160,
			overflow: true,
			streaming: true
		},
		{ name: 'stream-input-overflow', target: capacity + 256, overflow: true, streaming: true }
	]) {
		console.log(`Measuring ${scenario.name}`)
		const measurement = measured.get(scenario.target) ?? (await atBoundary(scenario.target))
		measured.set(scenario.target, measurement)
		const { messages, tokens, rows } = measurement
		const run: any = {
			...scenario,
			tokens,
			rows,
			messageCount: messages.length,
			requestedTotalTokens: tokens + reserve,
			passed: false
		}
		evidence.runs.push(run)
		await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
		const began = performance.now()
		try {
			let result: any
			if (scenario.streaming) {
				let answer = '',
					finishReason = '',
					usage: Record<string, unknown> | undefined
				for await (const event of stream(messages, [], undefined, undefined, {
					thinking: false,
					json: true,
					max_tokens: reserve
				})) {
					if (event.kind === 'text') {
						run.firstTextMs ??= performance.now() - began
						answer += event.text
					}
					if (event.kind === 'finish') finishReason = event.reason
					if (event.kind === 'usage') usage = event.usage
					assert.notEqual(event.kind, 'tool', 'No tool was offered or authorized')
				}
				result = { choices: [{ message: { content: answer }, finish_reason: finishReason }], usage }
			} else {
				const response = await gateway.openAiChatCompletion({
					model: 'context-qwen',
					messages,
					max_tokens: reserve,
					temperature: 0,
					chat_template_kwargs: template,
					response_format: { type: 'json_object' }
				})
				result = await response.json()
			}
			run.answer = result.choices?.[0]?.message?.content
			run.finishReason = result.choices?.[0]?.finish_reason
			run.usage = result.usage
			run.timing = result.aven?.timing
			assert(
				!scenario.overflow,
				'A request larger than the actual context must not be silently truncated'
			)
			assert.equal(run.finishReason, 'stop')
			assert.deepEqual(JSON.parse(run.answer), {
				museumCode: 'MOSS-ORBIT',
				room: 'East Atrium',
				weekday: 'Tuesday',
				invitationSent: false
			})
			assert(
				Math.abs(result.usage.prompt_tokens - tokens) <= 8,
				'Tokenizer measurement must match actual provider usage'
			)
			assert(
				Number.isSafeInteger(result.usage.completion_tokens) && result.usage.completion_tokens > 0
			)
			run.passed = true
		} catch (error) {
			run.error = {
				name: (error as any).name,
				...transportError(error)
			}
			run.passed =
				scenario.overflow === true &&
				run.error.code === 'LLM_CONTEXT_LIMIT' &&
				run.error.status === 422 &&
				run.error.retryable === false
		} finally {
			run.durationMs = performance.now() - began
			await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
			console.log(JSON.stringify(run))
		}
	}
	// A rejected oversized request must release the gateway's sole permit.
	const response = await gateway.openAiChatCompletion({
		model: 'context-qwen',
		max_tokens: reserve,
		temperature: 0,
		chat_template_kwargs: template,
		messages: [{ role: 'user', content: 'This is a fictional test. Reply with exactly: READY' }]
	})
	const recovered = await response.json()
	evidence.recovery = { answer: recovered.choices?.[0]?.message?.content, usage: recovered.usage }
	assert.equal(evidence.recovery.answer.trim(), 'READY')
	let streamedRecovery = ''
	for await (const event of stream(
		[{ role: 'user', content: 'Fictional stream recovery check. Reply with exactly READY.' }],
		[],
		undefined,
		undefined,
		{ thinking: false, max_tokens: reserve }
	)) {
		if (event.kind === 'text') streamedRecovery += event.text
	}
	evidence.recovery.streamedAnswer = streamedRecovery
	assert.equal(streamedRecovery.trim(), 'READY')
	evidence.passed = evidence.runs.every((run: any) => run.passed)
	assert(evidence.passed, 'Inspect failed boundary evidence; no failed sample is discarded.')
} finally {
	await writeFile(directory + '/evidence.json', JSON.stringify(evidence, null, 2))
}
