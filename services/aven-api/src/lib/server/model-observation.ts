import { randomBytes } from 'node:crypto'
import { AppError } from './errors.js'

export type ModelLane = 'interactive' | 'work'
export type ModelFailure =
	| 'cancelled'
	| 'timeout'
	| 'capacity'
	| 'transport'
	| 'context-limit'
	| 'invalid-request'
	| 'incomplete'
	| 'provider-failure'
export interface ModelTiming {
	traceId: string
	spanId: string
	parentSpanId: string | null
	queueMs: number | null
	firstByteMs: number | null
	totalMs: number
	inputBytes: number
	outputBytes: number
	inputTokens: number | null
	outputTokens: number | null
	cachedTokens: number | null
	status: 'ok' | ModelFailure
}
/** Allowlisted, content-free timings. Never log the provider body or user-supplied labels. */
export class ModelObservation {
	readonly traceId: string
	readonly spanId = randomBytes(8).toString('hex')
	readonly parentSpanId: string | null
	readonly startedAt = new Date().toISOString()
	readonly #started = performance.now()
	#acquired: number | null = null
	#first: number | null = null
	#bytes = 0
	#inputTokens: number | null = null
	#outputTokens: number | null = null
	#cachedTokens: number | null = null
	#finished: ModelTiming | null = null
	constructor(
		readonly modelId: string,
		readonly lane: ModelLane,
		readonly inputBytes: number,
		traceparent?: string | null,
		private emit: (event: Record<string, unknown>) => void = (event) =>
			console.info(JSON.stringify(event))
	) {
		const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/.exec(traceparent ?? '')
		const valid = match && !/^0+$/.test(match[1]!) && !/^0+$/.test(match[2]!)
		this.traceId = valid ? match[1]! : randomBytes(16).toString('hex')
		this.parentSpanId = valid ? match[2]! : null
	}
	get traceparent() {
		return `00-${this.traceId}-${this.spanId}-01`
	}
	acquired() {
		this.#acquired = performance.now()
	}
	bytes(count: number) {
		if (count > 0 && this.#first === null) this.#first = performance.now()
		this.#bytes += count
	}
	usage(value: unknown) {
		if (!value || typeof value !== 'object') return
		const v = value as Record<string, unknown>
		const integer = (n: unknown) =>
			typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null
		this.#inputTokens = integer(v.prompt_tokens ?? v.input_tokens)
		this.#outputTokens = integer(v.completion_tokens ?? v.output_tokens)
		this.#cachedTokens = integer(
			(v.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens
		)
	}
	finish(status: ModelTiming['status']): ModelTiming {
		if (this.#finished) return this.#finished
		this.#finished = {
			traceId: this.traceId,
			spanId: this.spanId,
			parentSpanId: this.parentSpanId,
			queueMs: this.#acquired === null ? null : this.#acquired - this.#started,
			firstByteMs: this.#first === null ? null : this.#first - this.#started,
			totalMs: performance.now() - this.#started,
			inputBytes: this.inputBytes,
			outputBytes: this.#bytes,
			inputTokens: this.#inputTokens,
			outputTokens: this.#outputTokens,
			cachedTokens: this.#cachedTokens,
			status
		}
		try {
			this.emit({
				event: 'model-request',
				version: 1,
				startedAt: this.startedAt,
				modelId: this.modelId,
				lane: this.lane,
				...this.#finished
			})
		} catch {
			/* Telemetry cannot fail work. */
		}
		return this.#finished
	}
}

const failures: Record<ModelFailure, { status: number; code: string; message: string }> = {
	cancelled: { status: 499, code: 'LLM_CANCELLED', message: 'The model request was cancelled.' },
	timeout: {
		status: 504,
		code: 'LLM_TIMEOUT',
		message: 'The model did not respond in time. Your input is still available.'
	},
	capacity: { status: 429, code: 'LLM_CAPACITY', message: 'The model is busy. Try again shortly.' },
	transport: {
		status: 503,
		code: 'LLM_TRANSPORT',
		message: 'The connection to the model was interrupted.'
	},
	'context-limit': {
		status: 422,
		code: 'LLM_CONTEXT_LIMIT',
		message: 'The model request exceeded its context limit.'
	},
	'invalid-request': {
		status: 422,
		code: 'LLM_INVALID_REQUEST',
		message: 'The model could not accept this request.'
	},
	incomplete: {
		status: 502,
		code: 'LLM_INCOMPLETE',
		message: 'The model response was incomplete.'
	},
	'provider-failure': {
		status: 502,
		code: 'LLM_PROVIDER_FAILURE',
		message: 'The model provider could not complete the request.'
	}
}
export function modelError(category: ModelFailure, observation: ModelObservation): AppError {
	observation.finish(category)
	const failure = failures[category]
	return new AppError(failure.status, failure.code, failure.message)
}
export function abortCategory(signal?: AbortSignal): ModelFailure {
	return signal?.aborted
		? signal.reason?.name === 'TimeoutError'
			? 'timeout'
			: 'cancelled'
		: 'transport'
}
/** Exact SGLang diagnostics observed at the input-only and input/output boundaries.
 * Validate their arithmetic; arbitrary echoed request text is not a protocol code. */
function numericContextExceeded(message: string): boolean {
	const inputOnly =
		/^The input \(([0-9]+) tokens\) is longer than the model's context length \(([0-9]+) tokens\)\.$/.exec(
			message
		)
	if (inputOnly) {
		const [, input, limit] = inputOnly.map(Number)
		return (
			Number.isSafeInteger(input) && Number.isSafeInteger(limit) && limit! > 0 && input! > limit!
		)
	}
	const combined =
		/^Requested token count exceeds the model's maximum context length of ([0-9]+) tokens\. You requested a total of ([0-9]+) tokens: ([0-9]+) tokens from the input messages and ([0-9]+) tokens for the completion\. Please reduce the number of tokens in the input messages or the completion to fit within the limit\.$/.exec(
			message
		)
	if (!combined) return false
	const [limit, total, input, output] = combined.slice(1).map(Number)
	return (
		[limit, total, input, output].every((n) => Number.isSafeInteger(n) && n! > 0) &&
		total! === input! + output! &&
		total! > limit!
	)
}
/** Recognize protocol codes or the bounded, numeric SGLang diagnostic. Never
 * classify arbitrary echoed prose or expose the provider's response body. */
export async function providerFailure(response: Response): Promise<ModelFailure> {
	let code: unknown
	let numericContextLimit = false
	const reader = response.body?.getReader()
	if (reader) {
		try {
			let size = 0
			let text = ''
			const decoder = new TextDecoder()
			while (size <= 4096) {
				const part = await reader.read()
				if (part.done) {
					const body = JSON.parse(text)
					code = body?.error?.code
					// SGLang emits a flat OpenAI error with numeric code 400, not
					// context_length_exceeded. Match the entire observed protocol
					// diagnostic, including its envelope and actual exceeded bound.
					if (
						response.status === 400 &&
						body?.object === 'error' &&
						body.type === 'BadRequestError' &&
						body.code === 400 &&
						typeof body.message === 'string'
					) {
						numericContextLimit = numericContextExceeded(body.message)
					}
					break
				}
				size += part.value.length
				if (size > 4096) break
				text += decoder.decode(part.value, { stream: true })
			}
		} catch {
			/* No raw body leaves this function. */
		} finally {
			await reader.cancel().catch(() => {})
		}
	}
	if (response.status === 429) return 'capacity'
	if (response.status === 408 || response.status === 504) return 'timeout'
	if (
		numericContextLimit ||
		['context_length_exceeded', 'context_window_exceeded', 'max_context_length_exceeded'].includes(
			String(code)
		)
	)
		return 'context-limit'
	return response.status === 400 || response.status === 422 ? 'invalid-request' : 'provider-failure'
}
