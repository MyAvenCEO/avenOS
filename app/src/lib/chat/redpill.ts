/**
 * The client half of the RedPill chat stream.
 *
 * The native host returns raw OpenAI-style SSE from the authenticated facade,
 * so this module only turns the byte stream into events.
 */

import {
	chatGatewayRequest,
	createGatewayModelStream,
	withStallWatchdog
} from '@avenos/chat-engine/gateway'
import { eventsFromFrame, streamEvents } from '@avenos/chat-engine/stream'
import { IncompleteModelStream } from '@avenos/chat-engine/stream-errors'
import { VisibleModelText } from '@avenos/chat-engine/visible-text'
import { type OpenAiChatCompletionRequest, streamOpenAiChat } from '$lib/models/gateway'

export { eventsFromFrame, sanitize, streamEvents } from '@avenos/chat-engine/stream'

import type { ChatMessage, StreamEvent, ToolSpec } from '@avenos/chat-engine/model'

export type { ChatMessage, ChatRole, StreamEvent, ToolSpec } from '@avenos/chat-engine/model'
export { IncompleteModelStream } from '@avenos/chat-engine/stream-errors'

export interface ToolCall {
	id: string
	name: string
	/** JSON, as the model wrote it — not parsed until it is executed. */
	arguments: string
}

/** Public gateway model ID for the latency-sensitive voice/chat lane. */
export const CHAT_MODEL = 'deepseek/deepseek-v4-flash-0731'

export interface ChatProxyRequest {
	messages: ChatMessage[]
	tools: ToolSpec[]
	model?: string
	temperature?: number
	json?: boolean
	thinking?: boolean
	max_tokens?: number
}

export function openAiGatewayRequest(input: ChatProxyRequest): OpenAiChatCompletionRequest {
	const model = input.model ?? CHAT_MODEL
	return chatGatewayRequest(
		{
			...input,
			model,
			...((model === CHAT_MODEL || input.thinking !== undefined) && {
				thinking: input.thinking ?? false
			})
		},
		model === CHAT_MODEL ? 16_384 : 32_768
	)
}

async function openChatStream(
	request: ChatProxyRequest,
	signal?: AbortSignal
): Promise<AsyncIterable<string>> {
	return streamOpenAiChat(openAiGatewayRequest(request), signal)
}

export const streamChat = createGatewayModelStream({
	request: openAiGatewayRequest,
	open: streamOpenAiChat
})

/**
 * The design lane: one whole completion from the stronger, slower model.
 *
 * Drafting an actor manifest is design work, not conversation — nobody is
 * waiting on a first token, and getting the contract right beats getting it
 * fast. So it runs on kimi-k3 while the voice loop stays on the fast lane.
 *
 * Reads structured drafting frames directly and validates the completed JSON.
 */
export const DESIGN_MODEL = 'moonshotai/kimi-k3'

export interface CompleteOptions {
	model?: string
	temperature?: number
	/** Enforce JSON output server-side (response_format json_object). */
	json?: boolean
	/**
	 * Requested completion budget. Rate limits are computed on REQUESTED
	 * tokens — a clarify round asking for 32k burns the whole minute window
	 * for ten lines of questions. Size the ask to the need; the proxy clamps.
	 */
	maxTokens?: number
	/**
	 * Abort seam: pressing Stop must stop the PROCESS — without a signal the
	 * chat turn dies but the design fetch keeps streaming and its result still
	 * lands. Wired from the live turn's controller.
	 */
	signal?: AbortSignal
	/**
	 * Live progress: reasoning models stream their deliberation as
	 * `reasoning_content` long before any answer text arrives. Surfacing it is
	 * the difference between "working…" and actually watching the model think.
	 * `status` carries lane-level waits (rate-limit backoff) — silence that
	 * LOOKS like a hang must say what it is.
	 */
	onDelta?: (delta: { reasoning?: string; text?: string; status?: string }) => void
}

/**
 * Degeneration guard for the machine lane: a model stuck in a repetition
 * loop ("stop_stop_stop…", "_z_z_z_z…") pads until max_tokens — minutes of
 * burn for guaranteed garbage. A ≥12-char unit repeated 7+ times back to
 * back does not occur in real JSON or code; catching it aborts the stream
 * early and turns the burn into a structured lane failure the scrum round
 * can retry.
 */
export function looksDegenerate(tail: string): boolean {
	if (tail.length < 400) return false
	const window = tail.slice(-512)
	// Verbatim repetition: a ≥12-char unit looping back to back.
	if (/(.{12,64}?)\1{6,}/s.test(window)) return true
	// Novel-word salad: frequency-penalty flight produces one endless "word"
	// that never repeats and never closes — 240+ chars without whitespace or
	// any JSON punctuation do not occur in real keys, values, or code.
	return /[^\s"'{}[\],:]{240,}/.test(window)
}

/** Wait out a rate limit without ignoring the Stop button. */
function backoff(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error('aborted during rate-limit backoff'))
		const timer = setTimeout(resolve, ms)
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer)
				reject(new Error('aborted during rate-limit backoff'))
			},
			{ once: true }
		)
	})
}

export async function complete(
	messages: ChatMessage[],
	options: CompleteOptions = {}
): Promise<string> {
	// Rate limits heal by WAITING — an instant retry (the flow's resample)
	// hits the same wall. The design lane is slow work anyway; two spaced
	// attempts beat failing the whole run because a minute was busy.
	for (let attempt = 0; ; attempt++) {
		const controller = new AbortController()
		const cancel = () => controller.abort()
		if (options.signal?.aborted) cancel()
		else options.signal?.addEventListener('abort', cancel, { once: true })
		try {
			const source = await openChatStream(
				{
					messages,
					tools: [],
					model: options.model ?? DESIGN_MODEL,
					...(typeof options.temperature === 'number' && { temperature: options.temperature }),
					...(options.json === true && { json: true }),
					...(typeof options.maxTokens === 'number' && { max_tokens: options.maxTokens })
				},
				controller.signal
			)
			let buffer = ''
			let text = ''
			const visible = new VisibleModelText()
			// Watch both answer and reasoning for repetition loops.
			let watched = ''
			let nextCheck = 1024
			let finishReason = ''
			for await (const chunk of withStallWatchdog(source, cancel)) {
				buffer += chunk
				const frames = buffer.split(/\r?\n\r?\n/)
				buffer = frames.pop() ?? ''
				for (const frame of frames) {
					const line = frame.split('\n').find((l) => l.startsWith('data:'))
					if (!line) continue
					const data = line.slice('data:'.length).trim()
					if (data === '' || data === '[DONE]') continue
					try {
						const choice = JSON.parse(data)?.choices?.[0]
						const delta = choice?.delta
						if (typeof choice?.finish_reason === 'string' && choice.finish_reason !== '') {
							finishReason = choice.finish_reason
						}
						if (typeof delta?.content === 'string' && delta.content !== '') {
							const answer = visible.push(delta.content)
							text += answer
							watched += delta.content
							if (answer) options.onDelta?.({ text: answer })
						}
						if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content !== '') {
							watched += delta.reasoning_content
							options.onDelta?.({ reasoning: delta.reasoning_content })
						}
					} catch {
						throw new IncompleteModelStream('The model stream contained an invalid data frame.')
					}
				}
				if (watched.length >= nextCheck) {
					nextCheck = watched.length + 1024
					if (looksDegenerate(watched)) {
						throw new Error(
							`degenerate model output — repetition loop after ~${Math.round(watched.length / 4)} tokens`
						)
					}
				}
			}
			if (finishReason === 'length') {
				throw new Error(
					'completion budget exhausted (finish_reason=length) — the answer was truncated ' +
						`after ~${Math.round(watched.length / 4)} streamed tokens (reasoning included)`
				)
			}
			if (finishReason !== 'stop')
				throw new IncompleteModelStream('Completion ended without a successful finish status')
			return text
		} catch (error) {
			const failure = error instanceof Error ? error.message : String(error)
			if (attempt < 2 && /rate.?limit|429/i.test(failure)) {
				const wait = 15_000 * (attempt + 1)
				options.onDelta?.({
					status: `rate limited \u2014 retry ${attempt + 2} in ${wait / 1000}s`
				})
				await backoff(wait, options.signal)
				continue
			}
			throw error
		} finally {
			cancel()
			options.signal?.removeEventListener('abort', cancel)
		}
	}
}

/**
 * Pull the first parseable JSON object out of model text, string-aware.
 *
 * The greedy first-{-to-last-} span dies the moment a model splices prose
 * between two objects ("I apologize—let me provide the correct manifest…").
 * This walks the text, collects every balanced top-level object, and returns
 * the first one that parses — preferring the LAST candidates, since a model
 * that corrected itself put the good object at the end.
 */
export function extractJsonObject(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		// fall through to the scan
	}
	const candidates: string[] = []
	let depth = 0
	let start = -1
	let inString = false
	let escaped = false
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (inString) {
			if (escaped) escaped = false
			else if (ch === '\\') escaped = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') inString = true
		else if (ch === '{') {
			if (depth === 0) start = i
			depth++
		} else if (ch === '}') {
			depth--
			if (depth === 0 && start !== -1) {
				candidates.push(text.slice(start, i + 1))
				start = -1
			}
			if (depth < 0) depth = 0
		}
	}
	for (const candidate of candidates.reverse()) {
		try {
			return JSON.parse(candidate)
		} catch {
			try {
				return JSON.parse(candidate.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"'))
			} catch {
				// next candidate
			}
		}
	}
	return null
}
