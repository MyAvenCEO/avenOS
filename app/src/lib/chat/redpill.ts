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

/**
 * One message on the wire — the standard OpenAI shape, tool lane included.
 *
 * It was not always this. Gemma's chat template had no tool role: sending a
 * result back as `role: "tool"` got an empty turn back, so results traveled
 * as user messages and every tool round left a synthetic assistant filler in
 * the history. Qwen imitated exactly that scaffolding — final answers of
 * literal "…", duplicated create calls — because to a model with a real tool
 * lane the workaround itself looks like degenerate conversation. With calls
 * and results in their proper fields, there is nothing fake to imitate.
 */
export interface ChatMessage {
	role: ChatRole
	content: string
	/** Assistant turns only: the calls made in that turn. */
	tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
	/** Tool turns only: which call this result answers. */
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
 * Characters this assistant is expected to produce: Latin with the German
 * accents, digits, whitespace, and ordinary punctuation.
 */
const EXPECTED = /[^\p{Script=Latin}\p{Nd}\p{P}\p{Zs}\n\r€$%+<=>^`|~°²³µ]/gu

/**
 * Drop characters the model had no business emitting.
 *
 * `phala/gemma-4-31b-it` intermittently corrupts its own output — doubled
 * fragments, stray capitals, and Arabic or CJK codepoints dropped into German
 * sentences ("Ja" arriving as "JaLHيJa"). Measured at roughly two replies in
 * six on a bad run and none in twelve on a good one, with tools, temperature
 * and the system prompt all ruled out as causes, and the non-TEE route to the
 * same weights affected too.
 *
 * So this treats the symptom, deliberately. It matters most for the voice: the
 * synthesizer will earnestly attempt to pronounce an Arabic letter dropped into
 * a German clause. The cost is that genuinely non-Latin replies are mangled,
 * which is an acceptable trade for an assistant that only speaks German.
 *
 * Also strips chat-template control tokens leaking into the prose (`<|"|>`,
 * `<|im_end|>`) — never something to show, let alone pronounce.
 */
const CONTROL_TOKENS = /<\|[^|>]{0,24}\|>/g

export function sanitize(text: string): string {
	return text.replace(CONTROL_TOKENS, '').replace(EXPECTED, '')
}

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
			// Prose additionally loses braces and pipes: German Fließtext has no use
			// for either, and single stray `}`s — leaked call syntax — slip under
			// any run-length guard. Arguments keep theirs; JSON needs them.
			const text = sanitize(delta.content).replace(/[{}|]/g, '')
			if (text !== '') events.push({ kind: 'text', text })
		}
		for (const call of delta.tool_calls ?? []) {
			events.push({
				kind: 'tool',
				index: call.index ?? 0,
				id: call.id,
				name: call.function?.name,
				// Sanitized like prose: the serving corruption hits this stream too,
				// and a stray Arabic glyph inside a title otherwise lands on the todo
				// list itself. The filter keeps JSON punctuation, so valid arguments
				// pass through untouched.
				args: call.function?.arguments
					? sanitize(call.function.arguments)
					: call.function?.arguments
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
 * Undo the model writing a tool call as code.
 *
 * The OpenAI shape is a bare `name` plus JSON `arguments`. This model
 * intermittently emits the whole call as Python instead — the name arrives as
 * `todo_create(titles=['Mehr Wasser trinken'])` with empty arguments — and
 * every such call failed as an unknown tool, after which the model cheerfully
 * confirmed work it had not done. The paren split recovers the name; the
 * kwargs are rewritten to JSON (quotes, True/False/None) and validated, so a
 * repair that does not parse falls through to the normal unreadable-arguments
 * error rather than inventing arguments.
 */
export function repairCall(call: ToolCall): ToolCall {
	const paren = call.name.indexOf('(')
	if (paren === -1) return call

	const name = call.name.slice(0, paren).trim()
	// The call may be split across name and arguments mid-token; the paren tail
	// plus whatever landed in arguments is the full kwargs text.
	const inner = (call.name.slice(paren) + call.arguments)
		.trim()
		.replace(/^\(/, '')
		.replace(/\)$/, '')

	if (inner.trim() === '') return { ...call, name, arguments: '{}' }

	const json = `{${inner
		.replace(/(\w+)\s*=/g, '"$1":')
		.replace(/'/g, '"')
		.replace(/\bTrue\b/g, 'true')
		.replace(/\bFalse\b/g, 'false')
		.replace(/\bNone\b/g, 'null')}}`
	try {
		JSON.parse(json)
		return { ...call, name, arguments: json }
	} catch {
		// Not rescuable — keep the recovered name so the runner's complaint is
		// about the arguments, which is the part that is actually wrong.
		return { ...call, name, arguments: inner }
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
	signal?: AbortSignal,
	model?: string
): AsyncGenerator<StreamEvent> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages, tools, ...(model && { model }) }),
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

/**
 * The composer lane: one whole completion from the stronger, slower model.
 *
 * Drafting an actor manifest is design work, not conversation — nobody is
 * waiting on a first token, and getting the contract right beats getting it
 * fast. So it runs on kimi-k3 while the voice loop stays on the fast lane.
 *
 * Deliberately NOT built on streamChat's events: the prose lane strips braces
 * and pipes as anti-glitch armor, which would gut the JSON this lane exists to
 * produce. The frames are read raw here — output for a machine, not a voice.
 */
export const COMPOSER_MODEL = 'moonshotai/kimi-k3'

export async function complete(messages: ChatMessage[], model = COMPOSER_MODEL): Promise<string> {
	const response = await fetch('/api/chat', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages, tools: [], model })
	})
	if (!response.ok || !response.body) throw new Error(await failureText(response))

	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buffer = ''
	let text = ''
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const frames = buffer.split('\n\n')
			buffer = frames.pop() ?? ''
			for (const frame of frames) {
				const line = frame.split('\n').find((l) => l.startsWith('data:'))
				if (!line) continue
				const data = line.slice('data:'.length).trim()
				if (data === '' || data === '[DONE]') continue
				try {
					const content = JSON.parse(data)?.choices?.[0]?.delta?.content
					if (typeof content === 'string') text += content
				} catch {
					// partial frames cannot occur (blank-line buffering); skip junk
				}
			}
		}
	} finally {
		reader.cancel().catch(() => {})
	}
	return text
}
