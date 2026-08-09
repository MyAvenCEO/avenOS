/**
 * The client half of the RedPill chat stream.
 *
 * `/api/chat` hands back raw OpenAI-style SSE, so all that is left here is
 * turning the byte stream into text deltas. Kept free of Svelte runes so it can
 * be unit-tested and reused outside a component.
 */

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
	role: ChatRole
	content: string
}

/**
 * Pull the text delta out of one OpenAI-compatible SSE frame.
 *
 * Returns `null` for anything with no text in it — the `[DONE]` sentinel, the
 * keep-alive comments some proxies emit, the opening frame that carries only a
 * role, and any frame we cannot parse. Exported for the tests.
 */
export function deltaFromFrame(frame: string): string | null {
	const line = frame.split('\n').find((l) => l.startsWith('data:'))
	if (!line) return null

	const data = line.slice('data:'.length).trim()
	if (data === '' || data === '[DONE]') return null

	try {
		const parsed = JSON.parse(data)
		const delta = parsed?.choices?.[0]?.delta?.content
		return typeof delta === 'string' && delta !== '' ? delta : null
	} catch {
		// A frame split across two network chunks would land here. The caller
		// buffers on the blank-line boundary precisely so that cannot happen, so
		// anything reaching this point is genuinely malformed and worth skipping
		// rather than throwing away the rest of the response.
		return null
	}
}

/**
 * A readable sentence out of a failed response.
 *
 * SvelteKit wraps `error()` as `{"message":"…"}` and RedPill nests its own under
 * `{"error":{"message":"…"}}`; showing either envelope raw in a chat bubble is
 * just noise around the one line that matters.
 */
async function failureText(response: Response): Promise<string> {
	const body = await response.text()
	try {
		const parsed = JSON.parse(body)
		const message = parsed?.message ?? parsed?.error?.message
		if (typeof message === 'string' && message !== '') return message
	} catch {
		// not JSON — fall through and show whatever came back
	}
	return body || `chat failed with ${response.status}`
}

/**
 * Stream one completion, yielding text as it arrives.
 *
 * Pass an `AbortSignal` to stop mid-sentence; aborting is a normal end to the
 * loop here, not an error the caller has to catch.
 */
export async function* streamChat(
	messages: ChatMessage[],
	signal?: AbortSignal
): AsyncGenerator<string> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages }),
		signal
	})

	if (!response.ok || !response.body) {
		throw new Error(await failureText(response))
	}

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })

			// SSE frames are separated by a blank line. Anything after the last
			// one is a partial frame — keep it in the buffer until its tail turns up.
			const frames = buffer.split('\n\n')
			buffer = frames.pop() ?? ''

			for (const frame of frames) {
				const delta = deltaFromFrame(frame)
				if (delta !== null) yield delta
			}
		}
	} finally {
		reader.cancel().catch(() => {})
	}
}
