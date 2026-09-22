/** Real model bytes over HTTP; only transport timing is fault-injected. */
import assert from 'node:assert/strict'
import { streamEvents } from '../../app/src/lib/chat/redpill'

const endpoint = process.env.LIVE_LLM_BASE_URL
const model = process.env.LIVE_LLM_MODEL
assert(endpoint && model, 'A trusted real model endpoint and model ID are required')

async function quietStream(
	keepAlive: boolean,
	observed: { bytes: number; firstDataAt: number; endedAt: number }
) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), 90000)
	const server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		// Production previously used Bun's default ten-second idle limit.
		idleTimeout: 10,
		async fetch(request, server) {
			if (keepAlive) server.timeout(request, 0)
			const upstream = await fetch(`${endpoint!.replace(/\/$/, '')}/chat/completions`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					stream: true,
					max_tokens: 512,
					chat_template_kwargs: { enable_thinking: false },
					messages: [
						{
							role: 'user',
							content:
								'Explain saved workflow definitions versus executions in three short sentences. Do not use tools.'
						}
					]
				}),
				signal: controller.signal
			})
			assert(upstream.ok && upstream.body)
			const reader = upstream.body.getReader()
			let first = true
			return new Response(
				new ReadableStream({
					async pull(output) {
						try {
							// Preserve actual bytes, but expose the long quiet interval that
							// real prefill/reasoning can have. No canned model output.
							if (!first) await Bun.sleep(12000)
							const part = await reader.read()
							if (part.done) {
								output.close()
								return
							}
							output.enqueue(part.value)
							if (first) first = false
							else {
								// One injected gap, then drain without further artificial delays.
								for (;;) {
									const next = await reader.read()
									if (next.done) {
										output.close()
										return
									}
									output.enqueue(next.value)
								}
							}
						} catch (error) {
							output.error(error)
						}
					},
					cancel: (reason) => reader.cancel(reason)
				}),
				{ headers: { 'content-type': 'text/event-stream' } }
			)
		}
	})
	try {
		const response = await fetch(server.url, { signal: controller.signal })
		assert(response.ok && response.body)
		const decoder = new TextDecoder()
		let text = '',
			finish = ''
		for await (const event of streamEvents(
			(async function* () {
				for await (const bytes of response.body!) {
					observed.bytes += bytes.length
					observed.firstDataAt ||= Date.now()
					yield decoder.decode(bytes, { stream: true })
				}
				yield decoder.decode()
			})()
		)) {
			if (event.kind === 'text') text += event.text
			if (event.kind === 'finish') finish = event.reason
		}
		assert.equal(finish, 'stop')
		assert(text.trim().length > 20)
		return text
	} finally {
		observed.endedAt = Date.now()
		clearTimeout(timer)
		controller.abort()
		server.stop(true)
	}
}
const baseline = { bytes: 0, firstDataAt: 0, endedAt: 0 }
await assert.rejects(() => quietStream(false, baseline))
assert(baseline.bytes > 0, 'Baseline must receive actual model bytes before the transport failure')
assert(
	baseline.endedAt - baseline.firstDataAt >= 9000,
	'Failure must occur in the injected idle interval'
)
console.log(
	'Reproduced: default HTTP idle timeout truncates an actual Qwen response during a quiet interval'
)
const answer = await quietStream(true, { bytes: 0, firstDataAt: 0, endedAt: 0 })
console.log(
	`Per-request model timeout preserves the same quiet interval and a complete real response: ${answer}`
)
