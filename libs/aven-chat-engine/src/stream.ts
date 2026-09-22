import type { StreamEvent } from './model'
import { IncompleteModelStream } from './stream-errors'
import { VisibleModelText } from './visible-text'

/** Remove leaked chat-template tokens; retain multilingual text and JSON punctuation. */
const CONTROL_TOKENS = /<\|[^|>]{0,24}\|>/g

export function sanitize(text: string): string {
	return text.replace(CONTROL_TOKENS, '')
}

/**
 * Pull events out of one OpenAI-compatible SSE frame.
 *
 * Returns nothing for frames with no payload — the `[DONE]` sentinel, the
 * keep-alives some proxies emit, the opening frame that carries only a role,
 * but rejects malformed data instead of silently losing text or tool arguments.
 */
export function eventsFromFrame(frame: string): StreamEvent[] {
	const line = frame.split('\n').find((l) => l.startsWith('data:'))
	if (!line) return []

	const data = line.slice('data:'.length).trim()
	if (data === '' || data === '[DONE]') return []

	try {
		const payload = JSON.parse(data)
		if (payload.error)
			throw new IncompleteModelStream(
				payload.error.code === 'LLM_STREAM_INTERRUPTED'
					? 'The model connection ended before its response was complete.'
					: 'The provider returned a stream error.'
			)
		const choice = payload.choices?.[0]
		const delta = choice?.delta ?? {}
		const events: StreamEvent[] = []
		if (payload.usage) events.push({ kind: 'usage', usage: payload.usage })
		if (typeof delta.content === 'string' && delta.content !== '') {
			const text = sanitize(delta.content)
			if (text !== '') events.push({ kind: 'text', text })
		}
		for (const call of delta.tool_calls ?? []) {
			events.push({
				kind: 'tool',
				index: call.index ?? 0,
				id: call.id,
				name: call.function?.name,
				// Arguments may contain verbatim source quotes; preserve them byte for byte.
				args: call.function?.arguments
			})
		}
		if (choice?.finish_reason) events.push({ kind: 'finish', reason: choice.finish_reason })
		return events
	} catch (error) {
		if (error instanceof IncompleteModelStream) throw error
		// Frames have already been assembled at the SSE boundary. Losing one
		// could turn partial arguments into a different but valid command.
		throw new IncompleteModelStream('The model stream contained an invalid data frame.')
	}
}

/** Shared SSE decoder: preserve completion status, including across split transport chunks. */
export async function* streamEvents(
	source: AsyncIterable<string>,
	signal?: AbortSignal
): AsyncGenerator<StreamEvent> {
	let buffer = ''
	let finished = false
	const visible = new VisibleModelText()
	for await (const chunk of source) {
		buffer += chunk

		// SSE frames are separated by a blank line. Anything after the last
		// one is a partial frame — keep it in the buffer until its tail turns up.
		const frames = buffer.split(/\r?\n\r?\n/)
		buffer = frames.pop() ?? ''

		for (const frame of frames) {
			for (const event of eventsFromFrame(frame)) {
				if (event.kind === 'text') {
					const text = visible.push(event.text)
					if (text) yield { kind: 'text', text }
					continue
				}
				if (event.kind === 'finish') finished = true
				yield event
			}
		}
	}
	for (const event of eventsFromFrame(buffer)) {
		if (event.kind === 'text') {
			const text = visible.push(event.text)
			if (text) yield { kind: 'text', text }
			continue
		}
		if (event.kind === 'finish') finished = true
		yield event
	}
	if (!finished && !signal?.aborted)
		throw new IncompleteModelStream('Stream ended without completion status')
}
