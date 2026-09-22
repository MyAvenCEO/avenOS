/** Real-Qwen transport failure injection: cut a real stream, then request a fresh completion. */
import assert from 'node:assert/strict'
import { transportError } from '@avenos/chat-engine/transport-error'
import { VisibleModelText } from '@avenos/chat-engine/visible-text'
import { IncompleteModelStream, streamEvents } from '../../app/src/lib/chat/redpill'
import type { ServerConfig } from '../../services/aven-api/src/lib/server/config'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'

// Optionally replay a reasoning envelope actually emitted in the live workday.
// Every character boundary is exercised; the fixture is a recorded Qwen answer,
// not a substitute model response used to make the product journey pass.
if (process.argv[2]) {
	const evidence = await Bun.file(process.argv[2]).json()
	assert.equal(evidence.synthetic, true)
	const answer = evidence.judgments
		.map((item: any) => item.answer)
		.find((text: string) => text.startsWith('<thinking>'))
	assert(answer, 'The supplied real workday must contain the observed envelope regression')
	const visible = new VisibleModelText()
	const text = [...answer].map((char) => visible.push(char)).join('')
	assert.equal(
		text.trim(),
		answer.slice(answer.indexOf('</thinking>') + '</thinking>'.length).trim()
	)
	console.log(
		'Recorded live reasoning envelope withheld at every fragment boundary; answer preserved'
	)
}

const endpoint = process.env.LIVE_LLM_BASE_URL
assert(endpoint, 'LIVE_LLM_BASE_URL is required; no model substitute is supported')
async function* source(cut: boolean) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 180000)
	try {
		const response = await fetch(`${endpoint!.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				model: process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next',
				messages: [
					{
						role: 'user',
						content:
							'In two short sentences, explain the difference between a saved workflow definition and a completed execution. This is a fictional software test; perform no actions.'
					}
				],
				stream: true,
				max_tokens: 512,
				chat_template_kwargs: { enable_thinking: false }
			}),
			signal: controller.signal
		})
		assert(response.ok && response.body, `Live model HTTP ${response.status}`)
		const decoder = new TextDecoder()
		let buffered = ''
		for await (const bytes of response.body as any) {
			const chunk = decoder.decode(bytes, { stream: true })
			if (!cut) {
				yield chunk
				continue
			}
			buffered += chunk
			const end = buffered.indexOf('\n\n')
			if (end >= 0) {
				const frame = buffered.slice(0, end + 2)
				assert(!/"finish_reason"\s*:\s*"/.test(frame), 'Fault must precede completion')
				yield frame
				return // Drop the remainder of an actual model stream, not a canned model response.
			}
		}
		if (!cut) yield decoder.decode()
	} finally {
		clearTimeout(timer)
		controller.abort()
	}
}
await assert.rejects(async () => {
	for await (const _ of streamEvents(source(true))) {
		/* Consume the interrupted model response. */
	}
}, IncompleteModelStream)
console.log('Real interrupted model stream rejected as incomplete, with no executable response')
let answer = '',
	finish = ''
for await (const event of streamEvents(source(false))) {
	if (event.kind === 'text') answer += event.text
	if (event.kind === 'finish') finish = event.reason
}
assert.equal(finish, 'stop')
assert(answer.trim().length > 20)
console.log(`Fresh live completion succeeded: ${answer}`)

// Interrupt an actual provider response inside the production gateway. Neither
// the model text nor the gateway's terminal SSE error is supplied by this test.
let interruptProvider = true
let disconnectProvider = false
const gateway = LlmGatewayService.fromConfig(
	{
		LLM_GATEWAY_ENABLED: true,
		LLM_GATEWAY_MAX_PARALLELISM: 1,
		LLM_GATEWAY_TIMEOUT_SECONDS: 180,
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: true,
		LLM_GATEWAY_CREDENTIALS_JSON: '{}',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'live-qwen',
				label: 'Live Qwen',
				baseUrl: endpoint,
				upstreamModel: process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next',
				profile: 'qwen-tools',
				authMode: 'none',
				capabilities: ['text-generation', 'streaming', 'tool-calling', 'structured-output']
			}
		])
	} as ServerConfig,
	async (url, init) => {
		if (disconnectProvider) {
			disconnectProvider = false
			const disconnected = new AbortController()
			disconnected.abort(Error('Injected pre-response network interruption'))
			return fetch(url, { ...init, signal: disconnected.signal })
		}
		const response = await fetch(url, init)
		if (!interruptProvider || !response.ok || !response.body) return response
		interruptProvider = false
		const reader = response.body.getReader()
		let delivered = false
		return new Response(
			new ReadableStream<Uint8Array>({
				async pull(controller) {
					if (delivered) {
						await reader.cancel('Injected real-stream interruption')
						controller.error(Error('Injected real-stream interruption'))
						return
					}
					const { done, value } = await reader.read()
					assert(!done && value?.length, 'Must interrupt actual streamed model data')
					assert(!/"finish_reason"\s*:\s*"/.test(new TextDecoder().decode(value)))
					delivered = true
					controller.enqueue(value)
				},
				cancel: (reason) => reader.cancel(reason)
			}),
			{ status: response.status, headers: response.headers }
		)
	}
)!
const gatewayRequest = {
	model: 'live-qwen',
	stream: true,
	max_tokens: 512,
	chat_template_kwargs: { enable_thinking: false },
	messages: [
		{
			role: 'user',
			content: 'In one sentence distinguish a saved Skill from a completed run. Perform no actions.'
		}
	]
}
const interrupted = await gateway.openAiChatCompletion(gatewayRequest)
const interruptedText = await interrupted.text()
assert(
	interruptedText.includes('LLM_STREAM_INTERRUPTED'),
	'Gateway must complete the HTTP body with an explicit failure, not a chunk decoding reset'
)
const failureFrame = interruptedText
	.split('\n')
	.filter((line) => line.startsWith('data: '))
	.map((line) => {
		try {
			return JSON.parse(line.slice(6))
		} catch {
			return null
		}
	})
	.find((frame) => frame?.error?.code === 'LLM_STREAM_INTERRUPTED')
assert(failureFrame)
for (const error of [
	JSON.stringify(failureFrame.error),
	new Error(JSON.stringify(failureFrame.error))
]) {
	const detail = transportError(error)
	assert.equal(detail.message, failureFrame.error.message)
	assert.equal(detail.code, 'LLM_STREAM_INTERRUPTED')
	assert.equal(detail.retryable, true)
}
console.log(
	'Actual gateway failure retains diagnostic code and retryability without exposing its JSON envelope as chat prose'
)
await assert.rejects(async () => {
	for await (const _ of streamEvents(
		(async function* () {
			yield interruptedText
		})()
	)) {
		/* consume */
	}
}, IncompleteModelStream)
const recovered = await gateway.openAiChatCompletion(gatewayRequest)
const recoveredText = await recovered.text()
let recoveredFinish = ''
for await (const event of streamEvents(
	(async function* () {
		yield recoveredText
	})()
))
	if (event.kind === 'finish') recoveredFinish = event.reason
assert.equal(recoveredFinish, 'stop')
console.log(
	'Live gateway interruption reports an explicit SSE failure; its single permit is released and fresh real completion succeeds'
)

// Real model + production Chat + production calculator. Drop one model request
// after the tool has completed; never substitute generated text or tool results.
const { createCalculationActor, MessageBus } = await import('../../libs/aven-actors/src')
const { openAiGatewayRequest } = await import('../../app/src/lib/chat/redpill')
;(globalThis as any).$state = (value: unknown) => value
const { Chat } = await import('../../app/src/lib/chat/chat.svelte')
const bus = new MessageBus(),
	calculator = createCalculationActor()
bus.register(calculator)
let executions = 0
const chat = new Chat(
	{},
	{
		get specs() {
			return bus.toolSpecs()
		},
		run: async (name, args) => {
			const result = await bus.dispatch('chat', name, JSON.parse(args))
			executions++
			if (executions === 1) disconnectProvider = true
			return result
		}
	},
	async function* (messages, tools, signal, _model, options = {}) {
		let response: Response
		try {
			response = await gateway.openAiChatCompletion(
				openAiGatewayRequest({ messages, tools, model: 'live-qwen', thinking: false, ...options }),
				signal
			)
		} catch (error) {
			// Match the public HTTP error envelope consumed by the native client.
			const e = error as { code: string; status: number; message: string }
			throw Error(
				JSON.stringify({
					code: e.code,
					status: e.status,
					message: e.message,
					retryable: e.status >= 500
				})
			)
		}
		async function* frames() {
			const reader = response.body!.getReader(),
				decoder = new TextDecoder()
			try {
				while (true) {
					const next = await reader.read()
					if (next.done) break
					yield decoder.decode(next.value, { stream: true })
				}
				yield decoder.decode()
			} finally {
				reader.releaseLock()
			}
		}
		yield* streamEvents(frames())
	}
)
try {
	await chat.send(
		'For this fictional warehouse, calculate 9 crates times 3. Use quantity:crate and scalar 3. Give just the exact result and no other calculation.'
	)
	assert.equal(chat.failure, null)
	assert.equal(executions, 1, 'A completed tool must not be repeated after the connection loss')
	assert(chat.diagnostics.some((d) => d.reason === 'retry-model-availability'))
	const turn = chat.turns.at(-1)!
	assert.match(turn.content, /27/)
	assert.equal(JSON.parse(turn.calls![0]!.result).outputs.calculation.result.value, '27')
	assert(turn.durationMs! > turn.calls![0]!.durationMs!)
	const path = `/tmp/aven-live-model-recovery-${Date.now()}.json`
	await Bun.write(
		path,
		JSON.stringify(
			{
				synthetic: true,
				passed: true,
				model: process.env.LIVE_LLM_MODEL ?? 'qwen3.8-flash-next',
				executions,
				turn,
				diagnostics: chat.diagnostics
			},
			null,
			2
		)
	)
	console.log(
		'PASS production Chat recovers a real gateway admission failure without repeating its completed calculator:',
		path
	)
} finally {
	calculator.dispose()
}
