import type { ExecutionEnvironment } from '@avenos/actors'
import { QueuedClientArtifactGateway } from '@avenos/artifact-store'
import { createDocumentActors } from '@avenos/document-ingest/actors'
import {
	documentRunStartRequest,
	DocumentExecutionRouter,
	InProcessDocumentExecutionHost
} from '@avenos/document-ingest/execution'
import {
	type ClientArtifactGateway,
	type ClientRunPublication,
	DocumentProcessingRuntime,
	type PublishedClientRun
} from '@avenos/document-ingest/runtime'
import { invoke } from '@tauri-apps/api/core'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { LlmDocumentModelGateway } from '$lib/actors/document-llm-gateway'
import { singleton } from '$lib/actors/singleton'
import { intents } from '$lib/intents/intents.svelte'
import { BrowserDocumentDecoder } from './browser-document-decoder'
import type { ArtifactProcessingLookup } from './processing'

interface ArtifactContent {
	mediaType: string
	base64: string
}

const PUBLICATION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const

function publicationErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function isRetryablePublicationError(error: unknown): boolean {
	const message = publicationErrorMessage(error)
	return (
		message.startsWith('Aven API unavailable:') ||
		message === 'Artifact Store is unavailable.' ||
		message === 'upload admission is temporarily exhausted'
	)
}

const documentModelGateway = singleton(
	'aven.document-model-gateway',
	() => new LlmDocumentModelGateway()
)
const actors = singleton('aven.document-processing-actors', () =>
	createDocumentActors(new BrowserDocumentDecoder(), documentModelGateway)
)
for (const actor of actors.all) {
	if (!bus.get(actor.uuid)) bus.register(actor)
}

class TauriClientArtifactGateway implements ClientArtifactGateway {
	async publish(run: ClientRunPublication): Promise<PublishedClientRun> {
		const { publicationId, ...body } = run
		return invoke<PublishedClientRun>('artifact_client_run_publish', {
			publicationId,
			run: body
		})
	}
}

const publicationGateway = singleton(
	'aven.client-artifact-publication-gateway',
	() =>
		new QueuedClientArtifactGateway(new TauriClientArtifactGateway(), {
			delaysMs: PUBLICATION_RETRY_DELAYS_MS,
			shouldRetry: isRetryablePublicationError
		})
)

class TauriDocumentSourceResolver {
	async resolve(source: { artifactId: string; originalName: string; declaredMediaType?: string }) {
		const content = await invoke<ArtifactContent>('artifact_content_get', {
			artifactId: source.artifactId
		})
		return {
			...source,
			declaredMediaType: source.declaredMediaType ?? content.mediaType,
			base64: content.base64
		}
	}
}

const documentSources = singleton(
	'aven.document-source-resolver',
	() => new TauriDocumentSourceResolver()
)
const localDocumentRuntime = singleton(
	'aven.local-document-runtime',
	() =>
		new DocumentProcessingRuntime(actors, publicationGateway, () => documentModelGateway.status(), {
			executionEnvironment: 'local',
			runtimeHost: 'desktop'
		})
)
const emulatedServerActors = singleton('aven.emulated-server-document-processing-actors', () =>
	createDocumentActors(new BrowserDocumentDecoder(), documentModelGateway)
)
const emulatedServerDocumentRuntime = singleton(
	'aven.emulated-server-document-runtime',
	() =>
		new DocumentProcessingRuntime(
			emulatedServerActors,
			publicationGateway,
			() => documentModelGateway.status(),
			{
				executionEnvironment: 'server',
				runtimeHost: 'in-process-server-emulation'
			}
		)
)

/**
 * Both placements use the same serialized host contract. The server host is
 * deliberately in-process for now; a remote transport can replace it without
 * changing upload, restart, or status semantics.
 */
export const clientDocumentRuntime = singleton(
	'aven.document-execution-router',
	() =>
		new DocumentExecutionRouter({
			local: new InProcessDocumentExecutionHost('local', localDocumentRuntime, documentSources),
			server: new InProcessDocumentExecutionHost(
				'server',
				emulatedServerDocumentRuntime,
				documentSources
			)
		})
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

export async function clientDocumentSourceExecutionEnvironment(
	artifactId: string
): Promise<ExecutionEnvironment | null> {
	let envelope: { payload?: { sourceKind?: unknown; executionEnvironment?: unknown } }
	try {
		envelope = await invoke<{
			payload?: { sourceKind?: unknown; executionEnvironment?: unknown }
		}>('artifact_get', { artifactId })
	} catch {
		return null
	}
	if (envelope.payload?.sourceKind !== 'client-actor-ingest') return null
	if (
		envelope.payload.executionEnvironment !== 'local' &&
		envelope.payload.executionEnvironment !== 'server'
	) {
		throw new Error(`client document source ${artifactId} has no execution environment`)
	}
	return envelope.payload.executionEnvironment
}

export async function processClientDocument(
	artifactId: string,
	originalName: string,
	declaredMediaType: string | undefined,
	executionEnvironment: ExecutionEnvironment
): Promise<void> {
	await clientDocumentRuntime.start(
		documentRunStartRequest(
			{ artifactId, originalName, ...(declaredMediaType && { declaredMediaType }) },
			executionEnvironment
		)
	)
}
