import { Channel, invoke } from '@tauri-apps/api/core'

export const LLM_CAPABILITIES = {
	textGeneration: 'text-generation',
	vision: 'vision',
	structuredOutput: 'structured-output',
	streaming: 'streaming',
	toolCalling: 'tool-calling'
} as const

export interface LlmModelDescriptor {
	id: string
	label: string
	capabilities: string[]
}

export type LlmContentPart =
	| { type: 'text'; text: string }
	| {
			type: 'image'
			mediaType: 'image/png' | 'image/jpeg'
			base64: string
			detail?: 'low' | 'high' | 'auto'
	  }

export interface LlmMessage {
	role: 'user' | 'assistant'
	content: LlmContentPart[]
}

export type LlmOutputRequest =
	| { format: 'text' }
	| {
			format: 'json'
			name: string
			description?: string
			schema: Record<string, unknown>
	  }

export interface LlmCompletionRequest {
	modelId: string
	requiredCapabilities?: string[]
	instructions?: string
	messages: LlmMessage[]
	output?: LlmOutputRequest
	temperature?: number
	maxOutputTokens?: number
}

export interface LlmGatewayReceipt {
	modelId: string
	modelLabel: string
	capabilities: string[]
	providerRequestId: string | null
	httpRequestId: string | null
	providerReportedModel: string
	profile: string
	usage: Record<string, unknown> | null
	finishReason: string | null
	requestKey: string
	inputDigest: string
	implementationDigest: string
}

export type LlmCompletionResponse =
	| { output: { format: 'text'; text: string }; receipt: LlmGatewayReceipt }
	| {
			output: { format: 'json'; value: Record<string, unknown> }
			receipt: LlmGatewayReceipt
	  }

/** Returns every model containing all required capabilities, in operator order. */
export async function discoverLlmModels(
	requiredCapabilities: string[] = []
): Promise<LlmModelDescriptor[]> {
	const response = await invoke<{ models: LlmModelDescriptor[] }>('llm_model_list', {
		capabilities: requiredCapabilities
	})
	return response.models
}

/** Completes with the exact selected id; the gateway never silently substitutes a model. */
export function completeWithLlm(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
	return invoke<LlmCompletionResponse>('llm_complete', { request })
}

/**
 * Raw OpenAI-compatible request. `model` is an Aven catalog id; all other
 * standard/provider-compatible fields are transported unchanged.
 */
export interface OpenAiChatCompletionRequest extends Record<string, unknown> {
	model: string
	messages: unknown[]
	stream?: boolean
}

export function completeOpenAiChat<T extends Record<string, unknown> = Record<string, unknown>>(
	request: OpenAiChatCompletionRequest
): Promise<T> {
	return invoke<T>('llm_openai_complete', { request: { ...request, stream: false } })
}

/**
 * Streams raw OpenAI-compatible SSE text. This preserves reasoning deltas,
 * tool-call fragments, usage frames and provider extensions byte-for-byte.
 */
export async function* streamOpenAiChat(
	request: OpenAiChatCompletionRequest,
	signal?: AbortSignal
): AsyncGenerator<string> {
	const requestId = crypto.randomUUID()
	const chunks: string[] = []
	let settled = false
	let failure: unknown
	let wake: (() => void) | undefined
	const notify = () => {
		wake?.()
		wake = undefined
	}
	const channel = new Channel<string>((chunk) => {
		chunks.push(chunk)
		notify()
	})
	const completion = invoke<void>('llm_openai_stream', {
		requestId,
		request: { ...request, stream: true },
		onChunk: channel
	})
		.catch((error) => {
			failure = error
		})
		.finally(() => {
			settled = true
			notify()
		})
	const cancel = () => {
		void invoke('llm_openai_stream_cancel', { requestId }).catch(() => {})
	}
	if (signal?.aborted) cancel()
	else signal?.addEventListener('abort', cancel, { once: true })
	try {
		while (!settled || chunks.length > 0) {
			const chunk = chunks.shift()
			if (chunk !== undefined) {
				yield chunk
				continue
			}
			await new Promise<void>((resolve) => {
				wake = resolve
			})
		}
		await completion
		if (failure !== undefined && !signal?.aborted) throw failure
	} finally {
		signal?.removeEventListener('abort', cancel)
		if (!settled) cancel()
	}
}
