import { chatActor } from '$lib/actors/chat.actor.svelte'
import { DocumentImportQueue, type DocumentImportQueueState } from './document-import-queue'

export const emailDocumentProcessing = $state<DocumentImportQueueState>({ pending: 0, active: 0 })
export const emailDocumentQueue = new DocumentImportQueue(emailDocumentProcessing, (id, cause) => {
	chatActor.core.markArtifactProcessingUnavailable(
		id,
		cause instanceof Error ? cause.message : String(cause)
	)
})
