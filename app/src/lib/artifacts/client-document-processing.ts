import { invoke } from '@tauri-apps/api/core'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { createDocumentActors, type DocumentSource } from '$lib/actors/document-actors'
import type {
	DocumentModelGateway,
	DocumentModelRequest,
	DocumentModelResponse
} from '$lib/actors/document-model'
import { singleton } from '$lib/actors/singleton'
import { intents } from '$lib/intents/intents.svelte'
import { BrowserDocumentDecoder } from './browser-document-decoder'
import {
	type ClientArtifactGateway,
	type ClientRunPublication,
	DocumentProcessingRuntime,
	type PublishedClientRun
} from './document-runtime'
import type { ArtifactProcessingLookup } from './processing'

interface ArtifactContent {
	mediaType: string
	base64: string
}

class TauriDocumentModelGateway implements DocumentModelGateway {
	status(): Promise<{ available: boolean; maxPages: number }> {
		return invoke('document_model_status')
	}

	complete(request: DocumentModelRequest): Promise<DocumentModelResponse> {
		return invoke<DocumentModelResponse>('document_model_complete', { request })
	}
}

const documentModelGateway = singleton(
	'aven.document-model-gateway',
	() => new TauriDocumentModelGateway()
)
const actors = singleton('aven.document-processing-actors', () =>
	createDocumentActors(new BrowserDocumentDecoder(), documentModelGateway)
)
for (const actor of actors.all) {
	if (!bus.get(actor.uuid)) bus.register(actor)
}

class TauriClientArtifactGateway implements ClientArtifactGateway {
	publish(run: ClientRunPublication): Promise<PublishedClientRun> {
		const { publicationId, ...body } = run
		return invoke<PublishedClientRun>('artifact_client_run_publish', {
			publicationId,
			run: body
		})
	}
}

export const clientDocumentRuntime = singleton(
	'aven.client-document-runtime',
	() =>
		new DocumentProcessingRuntime(actors, new TauriClientArtifactGateway(), () =>
			documentModelGateway.status()
		)
)

clientDocumentRuntime.onChange = (artifactId, presentation) => {
	chatActor.core.updateArtifactProcessing(artifactId, presentation)
	intents.updateFileProcessing(artifactId, presentation)
}

export function clientDocumentProcessingStatus(
	artifactId: string
): ArtifactProcessingLookup | null {
	const presentation = clientDocumentRuntime.status(artifactId)
	return presentation ? { pending: false, presentation } : null
}

export async function isClientDocumentSource(artifactId: string): Promise<boolean> {
	try {
		const envelope = await invoke<{ payload?: { sourceKind?: unknown } }>('artifact_get', {
			artifactId
		})
		return envelope.payload?.sourceKind === 'client-actor-ingest'
	} catch {
		return false
	}
}

export async function processClientDocument(
	artifactId: string,
	originalName: string,
	declaredMediaType?: string
): Promise<void> {
	const content = await invoke<ArtifactContent>('artifact_content_get', { artifactId })
	const source: DocumentSource = {
		artifactId,
		originalName,
		declaredMediaType: declaredMediaType ?? content.mediaType,
		base64: content.base64
	}
	await clientDocumentRuntime.start(source)
}
