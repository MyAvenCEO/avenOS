import {
	LLM_CAPABILITIES,
	type LlmCompletionRequest,
	type LlmContentPart,
	type LlmGatewayClient,
	type LlmModelDescriptor
} from '@avenos/llm-client'
import {
	DOCUMENT_MODEL_OUTPUT_NAMES,
	DOCUMENT_MODEL_SYSTEM_PROMPT,
	type DocumentModelGateway,
	type DocumentModelRequest,
	type DocumentModelResponse,
	MAX_MODEL_PAGES,
	UNTRUSTED_DOCUMENT_RULE
} from './model'

export type DocumentLlmClient = LlmGatewayClient

const REQUIRED_CAPABILITIES = [LLM_CAPABILITIES.vision, LLM_CAPABILITIES.structuredOutput] as const

interface ModelSelection {
	selected: LlmModelDescriptor | null
	alternatives: LlmModelDescriptor[]
}

/**
 * Capability-selected adapter from the document actor contract to the generic
 * authenticated LLM gateway. Selection is explicit and stable after the first
 * successful catalog lookup: a configured preference must match exactly;
 * otherwise the first operator-ordered compatible model is used.
 */
export class LlmDocumentModelGateway implements DocumentModelGateway {
	readonly #preferredModelId?: string
	readonly #client: DocumentLlmClient
	#selection?: Promise<ModelSelection>

	constructor(client: DocumentLlmClient, preferredModelId?: string) {
		this.#preferredModelId = preferredModelId
		this.#client = client
	}

	async status(): Promise<{
		available: boolean
		maxPages: number
		modelId?: string
		modelLabel?: string
		alternatives: Array<{ id: string; label: string }>
	}> {
		const { selected, alternatives } = await this.#select()
		return {
			available: selected !== null,
			maxPages: MAX_MODEL_PAGES,
			...(selected && { modelId: selected.id, modelLabel: selected.label }),
			alternatives: alternatives.map(({ id, label }) => ({ id, label }))
		}
	}

	async complete(request: DocumentModelRequest): Promise<DocumentModelResponse> {
		const { selected } = await this.#select()
		if (!selected) {
			throw new Error(
				this.#preferredModelId
					? `Preferred document model ${this.#preferredModelId} is unavailable.`
					: 'No model supports vision and structured output.'
			)
		}
		const completed = await this.#client.complete(documentLlmRequest(selected.id, request))
		if (completed.output.format !== 'json') {
			throw new Error('Document model returned text instead of structured output.')
		}
		return {
			structured: completed.output.value,
			receipt: {
				providerRequestId: completed.receipt.providerRequestId,
				httpRequestId: completed.receipt.httpRequestId,
				model: completed.receipt.modelId,
				modelLabel: completed.receipt.modelLabel,
				capabilities: completed.receipt.capabilities,
				providerReportedModel: completed.receipt.providerReportedModel,
				profile: completed.receipt.profile,
				usage: completed.receipt.usage,
				finishReason: completed.receipt.finishReason,
				requestKey: completed.receipt.requestKey,
				promptDigest: completed.receipt.inputDigest,
				implementationDigest: completed.receipt.implementationDigest
			}
		}
	}

	#select(): Promise<ModelSelection> {
		if (!this.#selection) {
			const pending = this.#client
				.discover([...REQUIRED_CAPABILITIES])
				.then((alternatives) => ({
					alternatives,
					selected: this.#preferredModelId
						? (alternatives.find((model) => model.id === this.#preferredModelId) ?? null)
						: (alternatives[0] ?? null)
				}))
				.catch((error) => {
					if (this.#selection === pending) this.#selection = undefined
					throw error
				})
			this.#selection = pending
		}
		return this.#selection
	}
}

export function documentLlmRequest(
	modelId: string,
	request: DocumentModelRequest
): LlmCompletionRequest {
	const trustedKind = request.expectedKind
		? `\n\nTrusted orchestration decision: retain document kind ${request.expectedKind}.`
		: ''
	const content: LlmContentPart[] = [
		{
			type: 'text',
			text: `${request.prompt}${trustedKind}\n\n<document_text>\n${request.documentText}\n</document_text>`
		},
		...request.images.map((image) => ({
			type: 'image' as const,
			mediaType: image.mediaType,
			base64: image.base64,
			detail: 'high' as const
		}))
	]
	return {
		modelId,
		requiredCapabilities: [...REQUIRED_CAPABILITIES],
		instructions: `${DOCUMENT_MODEL_SYSTEM_PROMPT}\n\n${UNTRUSTED_DOCUMENT_RULE}`,
		messages: [{ role: 'user', content }],
		output: {
			format: 'json',
			name: DOCUMENT_MODEL_OUTPUT_NAMES[request.procedure],
			schema: request.schema
		},
		temperature: 0,
		maxOutputTokens: 65_536
	}
}
