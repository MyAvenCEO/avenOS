import type { OpenAiChatCompletionRequest } from '@avenos/llm-client'
import type { ChatMessage, ModelStream, ToolSpec } from './model'
import { streamEvents } from './stream'
import { IncompleteModelStream } from './stream-errors'

export interface ChatGatewayInput {
	messages: ChatMessage[]
	tools: ToolSpec[]
	model: string
	temperature?: number
	json?: boolean
	thinking?: boolean
	max_tokens?: number
}

/** One request shape for native and server Chat. Model choice belongs to the host. */
export function chatGatewayRequest(
	input: ChatGatewayInput,
	maximumTokens = 32_768
): OpenAiChatCompletionRequest {
	return {
		model: input.model,
		messages: input.messages,
		stream: true,
		stream_options: { include_usage: true },
		...(input.thinking !== undefined && {
			chat_template_kwargs: { enable_thinking: input.thinking }
		}),
		max_tokens:
			typeof input.max_tokens === 'number'
				? Math.max(256, Math.min(maximumTokens, input.max_tokens))
				: maximumTokens,
		...(input.json === true && { response_format: { type: 'json_object' } }),
		temperature:
			typeof input.temperature === 'number' ? Math.max(0, Math.min(2, input.temperature)) : 0.2,
		...(input.tools.length > 0 && {
			tools: input.tools.map(({ name, description, parameters }) => ({
				type: 'function',
				function: { name, description, parameters }
			}))
		})
	}
}

export async function* withStallWatchdog(
	source: AsyncIterable<string>,
	cancel: () => void,
	stallMs = 75_000
): AsyncGenerator<string> {
	const iterator = source[Symbol.asyncIterator]()
	try {
		while (true) {
			let timer: ReturnType<typeof setTimeout> | undefined
			const stalled = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new IncompleteModelStream(`No model stream frames for ${stallMs / 1000}s`))
					cancel()
				}, stallMs)
			})
			let next: IteratorResult<string>
			try {
				next = await Promise.race([iterator.next(), stalled])
			} finally {
				clearTimeout(timer)
			}
			if (next.done) break
			yield next.value
		}
	} finally {
		await iterator.return?.()
	}
}

/** No provider call, retry or fallback is hidden here. Both hosts supply one
 * authenticated byte-stream port and share framing, cancellation and stall rules.
 */
export function createGatewayModelStream(host: {
	request(input: Omit<ChatGatewayInput, 'model'> & { model?: string }): OpenAiChatCompletionRequest
	open(
		request: OpenAiChatCompletionRequest,
		signal: AbortSignal
	): AsyncIterable<string> | Promise<AsyncIterable<string>>
}): ModelStream {
	return async function* (messages, tools, signal, model, options = {}) {
		const controller = new AbortController()
		const cancel = () => controller.abort()
		if (signal?.aborted) cancel()
		else signal?.addEventListener('abort', cancel, { once: true })
		try {
			controller.signal.throwIfAborted()
			const source = await host.open(
				host.request({ messages, tools, ...(model && { model }), ...options }),
				controller.signal
			)
			yield* streamEvents(withStallWatchdog(source, cancel), signal)
		} finally {
			cancel()
			signal?.removeEventListener('abort', cancel)
		}
	}
}
