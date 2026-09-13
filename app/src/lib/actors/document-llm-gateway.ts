import {
	type DocumentLlmClient,
	LlmDocumentModelGateway as HeadlessDocumentModelGateway
} from '@avenos/document-ingest/llm-gateway'
import { transportError } from '$lib/artifacts/transport-error'
import { completeWithLlm, discoverLlmModels } from '$lib/models/gateway'

const defaultClient: DocumentLlmClient = {
	discover: discoverLlmModels,
	complete: async (request) => {
		try {
			return await completeWithLlm(request)
		} catch (error) {
			const details = transportError(error)
			throw Object.assign(new Error(details.message), { retryable: details.retryable })
		}
	}
}

/** Desktop adapter which supplies the Tauri-backed authenticated LLM client. */
export class LlmDocumentModelGateway extends HeadlessDocumentModelGateway {
	constructor(preferredModelId?: string, client: DocumentLlmClient = defaultClient) {
		super(client, preferredModelId)
	}
}

export type { DocumentLlmClient } from '@avenos/document-ingest/llm-gateway'
export { documentLlmRequest } from '@avenos/document-ingest/llm-gateway'
