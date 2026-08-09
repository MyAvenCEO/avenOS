/**
 * The client half of the RedPill chat stream.
 *
 * `/api/chat` hands back raw OpenAI-style SSE, so all that is left here is
 * turning the byte stream into events. Kept free of Svelte runes so it can be
 * unit-tested and reused outside a component.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
	id: string
	name: string
	/** JSON, as the model wrote it — not parsed until it is executed. */
	arguments: string
}

export interface ChatMessage {
	role: ChatRole
	content: string
	/** Present on an assistant turn that decided to call something. */
	tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
	/** Present on a tool result, tying it back to the call. */
	tool_call_id?: string
}

/** A tool as the model is told about it. */
export interface ToolSpec {
	name: string
	description: string
	parameters: Record<string, unknown>
}

export type StreamEvent =
	| { kind: 'text'; text: string }
	/** One fragment of a tool call. Name and arguments arrive in pieces. */
	| { kind: 'tool'; index: number; id?: string; name?: string; args?: string }

/**
 * Pull events out of one OpenAI-compatible SSE frame.
 *
 * Returns nothing for frames with no payload — the `[DONE]` sentinel, the
 * keep-alives some proxies emit, the opening frame that carries only a role,
 * and anything unparseable. Exported for the tests.
 */
export function eventsFromFrame(frame: string): StreamEvent[] {
	const line = frame.split('\n').find((l) => l.startsWith('data:'))
	if (!line) return []

	const data = line.slice('data:'.length).trim()
	if (data === '' || data === '[DONE]') return []

	try {
		const delta = JSON.parse(data)?.choices?.[0]?.delta
		if (!delta) return []

		const events: StreamEvent[] = []
		if (typeof delta.content === 'string' && delta.content !== '') {
			events.push({ kind: 'text', text: delta.content })
		}
		for (const call of delta.tool_calls ?? []) {
			events.push({
				kind: 'tool',
				index: call.index ?? 0,
				id: call.id,
				name: call.function?.name,
				args: call.function?.arguments
			})
		}
		return events
	} catch {
		// A frame split across two network chunks would land here. The caller
		// buffers on the blank-line boundary precisely so that cannot happen, so
		// anything reaching this point is genuinely malformed and worth skipping
		// rather than throwing away the rest of the response.
		return []
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
 * Stream one completion, yielding events as they arrive.
 *
 * Pass an `AbortSignal` to stop mid-sentence; aborting is a normal end to the
 * loop here, not an error the caller has to catch.
 */
export async function* streamChat(
	messages: ChatMessage[],
	tools: ToolSpec[],
	signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages, tools }),
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
				for (const event of eventsFromFrame(frame)) yield event
			}
		}
	} finally {
		reader.cancel().catch(() => {})
	}
}
