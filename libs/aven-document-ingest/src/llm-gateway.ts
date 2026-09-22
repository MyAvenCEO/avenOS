import {
	LLM_CAPABILITIES,
	type LlmCompletionRequest,
	type LlmContentPart,
	type LlmGatewayClient,
	type LlmModelDescriptor,
	portableUsage
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

function requiredCapabilities(vision: boolean): string[] {
	return [LLM_CAPABILITIES.structuredOutput, ...(vision ? [LLM_CAPABILITIES.vision] : [])]
}

interface ModelSelection {
	selected: LlmModelDescriptor | null
	alternatives: LlmModelDescriptor[]
}

/**
 * Capability-selected adapter from the document actor contract to the generic
 * authenticated LLM gateway. Selection is explicit and cached for 60 seconds: a configured preference must match exactly;
 * otherwise the first operator-ordered compatible model is used.
 */
export class LlmDocumentModelGateway implements DocumentModelGateway {
	readonly #preferredModelId?: string
	readonly #client: DocumentLlmClient
	#selections = new Map<boolean, { at: number; pending: Promise<ModelSelection> }>()
	invalidate(): void {
		this.#selections.clear()
	}

	constructor(client: DocumentLlmClient, preferredModelId?: string) {
		this.#preferredModelId = preferredModelId
		this.#client = client
	}

	async status(): Promise<{
		available: boolean
		maxPages: number
		maxParallelism: number
		modelId?: string
		modelLabel?: string
		alternatives: Array<{ id: string; label: string }>
	}> {
		const { selected, alternatives } = await this.#select(true)
		return {
			available: selected !== null,
			maxPages: MAX_MODEL_PAGES,
			maxParallelism: selected?.maxParallelism ?? 1,
			...(selected && { modelId: selected.id, modelLabel: selected.label }),
			alternatives: alternatives.map(({ id, label }) => ({ id, label }))
		}
	}

	async complete(
		request: DocumentModelRequest,
		options?: { signal?: AbortSignal }
	): Promise<DocumentModelResponse> {
		const vision = request.images.length > 0
		const { selected } = await this.#select(vision)
		if (!selected) {
			throw new Error(
				this.#preferredModelId
					? `Preferred document model ${this.#preferredModelId} is unavailable.`
					: `No model supports ${vision ? 'vision and ' : ''}structured output.`
			)
		}
		const completed = await this.#client.complete(documentLlmRequest(selected.id, request), options)
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
				usage: portableUsage(completed.receipt.usage),
				finishReason: completed.receipt.finishReason,
				requestKey: completed.receipt.requestKey,
				promptDigest: completed.receipt.inputDigest,
				implementationDigest: completed.receipt.implementationDigest
			}
		}
	}

	#select(vision: boolean): Promise<ModelSelection> {
		const cached = this.#selections.get(vision)
		if (!cached || Date.now() - cached.at > 60_000) {
			const pending = this.#client
				.discover(requiredCapabilities(vision))
				.then((alternatives) => ({
					alternatives,
					selected: this.#preferredModelId
						? (alternatives.find((model) => model.id === this.#preferredModelId) ?? null)
						: (alternatives[0] ?? null)
				}))
				.catch((error) => {
					if (this.#selections.get(vision)?.pending === pending) this.#selections.delete(vision)
					throw error
				})
			this.#selections.set(vision, { at: Date.now(), pending })
			return pending
		}
		return cached.pending
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
		...request.images.flatMap((image) => [
			{ type: 'text' as const, text: `Original source page ${image.page}:` },
			{
				type: 'image' as const,
				mediaType: image.mediaType,
				base64: image.base64,
				detail: 'high' as const
			}
		])
	]
	return {
		modelId,
		requiredCapabilities: requiredCapabilities(request.images.length > 0),
		instructions: `${DOCUMENT_MODEL_SYSTEM_PROMPT}\n\n${UNTRUSTED_DOCUMENT_RULE}`,
		messages: [{ role: 'user', content }],
		output: {
			format: 'json',
			name: DOCUMENT_MODEL_OUTPUT_NAMES[request.procedure],
			schema: request.schema
		},
		temperature: 0,
		maxOutputTokens: documentOutputTokenBudget(request)
	}
}

/**
 * Avoid reserving the protocol maximum for every tiny classification. Local
 * serving engines use max_tokens for admission/KV planning, so an unnecessary
 * 65k reservation can leave a small one-page request waiting until timeout.
 * Budgets grow with visible source text and retain the full allowance for
 * large finance extractions.
 */
export function documentOutputTokenBudget(request: DocumentModelRequest): number {
	const textTokensUpperBound = Math.ceil(new TextEncoder().encode(request.documentText).length / 2)
	if (request.procedure === 'classify-document') return 4_096
	if (request.procedure === 'summarize-sources') return 8_192
	if (request.procedure === 'analyze-page') {
		return Math.min(32_768, Math.max(8_192, textTokensUpperBound * 4))
	}
	return Math.min(65_536, Math.max(16_384, textTokensUpperBound * 8))
}
