/** All assistant messages in this growing conversation come from actual Qwen.
 * Complements bounded ChatCore/native restoration with sequential provider-capacity proof. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { chatGatewayRequest, createGatewayModelStream } from '@avenos/chat-engine/gateway'
import type { ChatMessage } from '@avenos/chat-engine/model'
import { transportError } from '@avenos/chat-engine/transport-error'
import { LlmGatewayService } from '../../services/aven-api/src/lib/server/llm-gateway'
import { testConfig } from '../../services/aven-api/tests/helpers'

const base = process.env.LIVE_LLM_BASE_URL?.replace(/\/$/, '')
assert(base, 'A trusted real Qwen provider with /tokenize is required.')
const response = await fetch(base + '/models', { signal: AbortSignal.timeout(30_000) })
assert(response.ok)
const descriptor = (await response.json()).data.find((entry: any) =>
	process.env.LIVE_LLM_MODEL ? entry.id === process.env.LIVE_LLM_MODEL : /qwen/i.test(entry.id)
)
assert(descriptor && /qwen/i.test(descriptor.id))
const model: string = descriptor.id,
	capacity: number = descriptor.max_model_len
assert(Number.isSafeInteger(capacity) && capacity >= 16_384 && capacity <= 1_048_576)
const directory = await mkdtemp('/tmp/aven-live-growing-conversation-')
const evidence: any = {
	synthetic: true,
	passed: false,
	model,
	capacity,
	runs: [],
	fingerprints: {},
	scope:
		'Sequential real Qwen through the production gateway/stream decoder; exact provider token sizing and a disk transcript reload. Not ChatCore history selection, native, SQL or worker recovery.'
}
for (const file of [
	'deploy/e2e/live-growing-conversation.ts',
	'libs/aven-chat-engine/src/gateway.ts',
	'libs/aven-chat-engine/src/stream.ts',
	'services/aven-api/src/lib/server/llm-gateway.ts'
])
	evidence.fingerprints[file] = createHash('sha256')
		.update(await readFile(file))
		.digest('hex')
const save = () =>
	writeFile(`${directory}/evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
const gateway = LlmGatewayService.fromConfig(
	testConfig({
		LLM_GATEWAY_ENABLED: 'true',
		LLM_GATEWAY_ALLOW_INSECURE_HTTP: 'true',
		LLM_GATEWAY_MAX_PARALLELISM: '1',
		LLM_GATEWAY_TIMEOUT_SECONDS: '600',
		LLM_GATEWAY_MODELS_JSON: JSON.stringify([
			{
				id: 'growing-qwen',
				label: 'Qwen',
				baseUrl: base,
				upstreamModel: model,
				profile: 'qwen-tools',
				authMode: 'none',
				timeoutSeconds: 600,
				capabilities: ['text-generation', 'streaming', 'structured-output']
			}
		])
	})
)!
const stream = createGatewayModelStream({
	request: (input) => chatGatewayRequest({ ...input, model: 'growing-qwen', temperature: 0 }, 512),
	open: async function* (request, signal) {
		const response = await gateway.openAiChatCompletion(request, signal)
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		for await (const bytes of response.body) yield decoder.decode(bytes, { stream: true })
		yield decoder.decode()
	}
})
async function tokens(messages: ChatMessage[]): Promise<number> {
	const response = await fetch(base + '/tokenize', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ model, messages, chat_template_kwargs: { enable_thinking: false } }),
		signal: AbortSignal.timeout(60_000)
	})
	assert(response.ok, `Provider tokenizer failed: ${response.status}`)
	const result = await response.json()
	assert(Number.isSafeInteger(result.count) && result.max_model_len === capacity)
	return result.count
}
let history: ChatMessage[] = [
	{
		role: 'system',
		content:
			"This is a fictional planning conversation. Use the user's latest explicit corrections, not unrelated inventory notes. No action or dispatch is authorized. Every reply must be one JSON object with exactly projectCode (string), crateColor (English string), assemblyDay (English weekday), copies (integer), dispatched (boolean). Keep the whole current state, not just the changed field. No prose."
	}
]
const state = {
	projectCode: 'TEST-' + randomUUID().slice(0, 8),
	crateColor: 'violet',
	assemblyDay: 'Monday',
	copies: 3,
	dispatched: false
}
// Size only the NEW user input. Never rewrite or replace an actual model reply.
async function fit(prefix: string, target: number, index: number) {
	const message = (rows: number): ChatMessage => ({
		role: 'user',
		content:
			prefix +
			'\nUnrelated fictional inventory notes:\n' +
			Array.from(
				{ length: rows },
				(_, row) =>
					`Sample ${index}-${row}: cardboard pinecone, linen planet, glass leaf; inventory only, no dispatch.\n`
			).join('') +
			'\nReturn the current planning state.'
	})
	const empty = await tokens([...history, message(0)])
	assert(empty <= target, 'Accepted history unexpectedly exceeds the next planned boundary')
	let low = 0,
		high = Math.ceil((target - empty) / 5) + 1
	assert((await tokens([...history, message(high)])) > target)
	while (low + 1 < high) {
		const middle = Math.floor((low + high) / 2)
		if ((await tokens([...history, message(middle)])) <= target) low = middle
		else high = middle
	}
	const input = message(low),
		count = await tokens([...history, input])
	assert(count <= target && target - count < 96, 'Must actually reach the requested boundary')
	return { input, count }
}
async function send(name: string, input: ChatMessage, reserve = 512, overflow = false) {
	const messages = [...history, input],
		count = await tokens(messages)
	const began = performance.now()
	const run: any = {
		name,
		inputTokens: count,
		reserve,
		messageCount: messages.length,
		expected: { ...state },
		answer: '',
		passed: false
	}
	evidence.runs.push(run)
	await save()
	try {
		for await (const event of stream(messages, [], undefined, undefined, {
			thinking: false,
			json: true,
			max_tokens: reserve
		})) {
			if (event.kind === 'text') {
				run.firstTextMs ??= performance.now() - began
				run.answer += event.text
			}
			if (event.kind === 'usage') run.usage = event.usage
			if (event.kind === 'finish') run.finishReason = event.reason
			assert.notEqual(event.kind, 'tool')
		}
		assert(!overflow, 'Oversized input must not be silently truncated')
		assert.equal(run.finishReason, 'stop')
		const answer = JSON.parse(run.answer)
		assert.deepEqual(
			{
				...answer,
				crateColor: answer.crateColor?.toLowerCase(),
				assemblyDay: answer.assemblyDay?.toLowerCase()
			},
			{ ...state, assemblyDay: state.assemblyDay.toLowerCase() }
		)
		assert(Math.abs(run.usage.prompt_tokens - count) <= 8)
		assert(Number.isSafeInteger(run.usage.completion_tokens) && run.usage.completion_tokens > 0)
		history.push(input, { role: 'assistant', content: run.answer })
		await writeFile(`${directory}/transcript.json`, JSON.stringify(history), { mode: 0o600 })
		run.passed = true
	} catch (error) {
		run.error = transportError(error)
		run.passed =
			overflow &&
			run.answer === '' &&
			run.error.code === 'LLM_CONTEXT_LIMIT' &&
			run.error.status === 422 &&
			run.error.retryable === false
		if (!run.passed) throw error
	} finally {
		run.durationMs = performance.now() - began
		await save()
		console.log(JSON.stringify(run))
	}
}
try {
	for (let index = 0; index < 28; index++) {
		let prefix =
			index === 0
				? `For our fictional clockwork rehearsal, project code ${state.projectCode}. Violet crates, assembly Monday, three copies. Nothing dispatched; planning only.`
				: 'More unrelated inventory, no planning change.'
		if (index === 8) {
			prefix = 'Korrektur: Die Kisten sind türkis statt violett. Alles andere bleibt.'
			state.crateColor = 'turquoise'
		}
		if (index === 16) {
			prefix = 'On assemble vendredi, pas lundi. Toujours un brouillon, rien envoyé.'
			state.assemblyDay = 'Friday'
		}
		if (index === 24) {
			prefix = 'actually make it five copies pls. still only planning, nothing sent'
			state.copies = 5
		}
		const target = Math.floor(capacity * (0.02 + (index * 0.96) / 27)) - 512
		const fitted = await fit(prefix, target, index)
		await send(`growing-turn-${index + 1}`, fitted.input)
		if (index === 13) {
			const reloaded = JSON.parse(await readFile(`${directory}/transcript.json`, 'utf8'))
			assert.deepEqual(reloaded, history)
			history = reloaded
			evidence.reloadedAfterTurn = 14
		}
	}
	const edge = await fit(
		'Final check. Keep the corrected state; do not dispatch anything.',
		capacity - 512 - 128,
		28
	)
	await send('sequential-history-at-edge', edge.input)
	const acceptedDigest = createHash('sha256').update(JSON.stringify(history)).digest('hex')
	const oversized = await fit('Oversized draft; no new action.', capacity + 256, 29)
	await send('overflow-after-live-conversation', oversized.input, 512, true)
	assert.equal(
		createHash('sha256').update(JSON.stringify(history)).digest('hex'),
		acceptedDigest,
		'A failed draft must not change the last accepted transcript'
	)
	const followup: ChatMessage = {
		role: 'user',
		content: 'Shorter request: current planning state only, nothing dispatched.'
	}
	assert(
		(await tokens([...history, followup])) + 256 <= capacity,
		'Recovery must fit without dropping accepted history'
	)
	await send('same-history-recovery-after-overflow', followup, 256)
	assert.equal(history.filter((m) => m.role === 'assistant').length, 30)
	evidence.passed = true
} catch (error) {
	evidence.error = String(error)
	throw error
} finally {
	await save()
	console.log(`Evidence: ${directory}/evidence.json`)
}
