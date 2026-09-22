import type {
	LlmCompletionRequest,
	LlmCompletionResponse,
	LlmGatewayClient,
	LlmModelDescriptor
} from './index'

export interface HttpLlmGatewayClientOptions {
	baseUrl: string
	bearerToken: string | (() => string | Promise<string>)
	fetch?: typeof fetch
}

/** Service-authenticated transport for headless LLM gateway consumers. */
export class HttpLlmGatewayClient implements LlmGatewayClient {
	readonly #baseUrl: string
	readonly #bearerToken: HttpLlmGatewayClientOptions['bearerToken']
	readonly #fetch: typeof fetch

	constructor(options: HttpLlmGatewayClientOptions) {
		const base = new URL(options.baseUrl)
		if (
			!['http:', 'https:'].includes(base.protocol) ||
			base.username ||
			base.password ||
			base.search ||
			base.hash
		)
			throw Error('Invalid LLM gateway configuration')
		this.#baseUrl = options.baseUrl.replace(/\/$/, '')
		this.#bearerToken = options.bearerToken
		this.#fetch = options.fetch ?? fetch
	}

	async discover(requiredCapabilities: string[]): Promise<LlmModelDescriptor[]> {
		const url = new URL(`${this.#baseUrl}/models`)
		for (const capability of requiredCapabilities) url.searchParams.append('capability', capability)
		const body = await this.#request(url, { method: 'GET' })
		if (
			!body ||
			typeof body !== 'object' ||
			!Array.isArray((body as { models?: unknown }).models)
		) {
			throw new Error('LLM gateway returned an invalid model catalog')
		}
		return (body as { models: LlmModelDescriptor[] }).models
	}

	async complete(
		request: LlmCompletionRequest,
		options?: { signal?: AbortSignal }
	): Promise<LlmCompletionResponse> {
		return (await this.#request(new URL(`${this.#baseUrl}/completions`), {
			method: 'POST',
			signal: options?.signal,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(request)
		})) as LlmCompletionResponse
	}

	async #request(url: URL, init: RequestInit): Promise<unknown> {
		return (await this.#send(url, init)).json()
	}

	/** Same bounded gateway and model policy as native chat, using service authority.
	 * The caller consumes/cancels the returned stream; this client never retries it.
	 */
	async openAiChatCompletion(
		request: import('./index').OpenAiChatCompletionRequest,
		options?: { signal?: AbortSignal; traceparent?: string }
	): Promise<Response> {
		return this.#send(new URL(`${this.#baseUrl}/v1/chat/completions`), {
			method: 'POST',
			signal: options?.signal,
			headers: {
				'content-type': 'application/json',
				...(options?.traceparent && { traceparent: options.traceparent })
			},
			body: JSON.stringify(request)
		})
	}

	async #send(url: URL, init: RequestInit): Promise<Response> {
		const token =
			typeof this.#bearerToken === 'function' ? await this.#bearerToken() : this.#bearerToken
		const headers = new Headers(init.headers)
		headers.set('authorization', `Bearer ${token}`)
		const signal = init.signal
			? AbortSignal.any([init.signal, AbortSignal.timeout(900_000)])
			: AbortSignal.timeout(900_000)
		const response = await this.#fetch(
			new Request(url, { ...init, headers, signal, redirect: 'manual' })
		).catch((error) => {
			throw Object.assign(error, { retryable: true })
		})
		if (!response.ok) {
			await response.body?.cancel()
			throw Object.assign(new Error(`LLM gateway request failed with status ${response.status}`), {
				retryable: response.status === 408 || response.status === 429 || response.status >= 500
			})
		}
		return response
	}
}
