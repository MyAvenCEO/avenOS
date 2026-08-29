import {
	AVEN_CEO_AUTHORITY,
	type ExecutionEnvironment,
	portableRunClone,
	resourceId
} from '@avenos/actors'
import type { ArtifactProcessingPresentation } from '@avenos/artifact-store'
import type { DocumentSource } from './actors'
import type { DocumentProcessingRuntime } from './runtime'

export const DOCUMENT_INGEST_RUN_PROTOCOL = resourceId({
	authority: AVEN_CEO_AUTHORITY,
	kind: 'protocol',
	namespace: 'docs.ingest',
	name: 'document-run',
	version: '1'
})

export const DOCUMENT_INGEST_SKILL = resourceId({
	authority: AVEN_CEO_AUTHORITY,
	kind: 'skill',
	namespace: 'docs.ingest',
	name: 'document-ingest',
	version: '1'
})

export interface DocumentSourceDescriptor {
	artifactId: string
	originalName: string
	declaredMediaType?: string
}

export interface DocumentRunStartRequest {
	protocol: typeof DOCUMENT_INGEST_RUN_PROTOCOL
	skillRef: typeof DOCUMENT_INGEST_SKILL
	requestId: string
	idempotencyKey: string
	requestedAt: string
	executionEnvironment: ExecutionEnvironment
	source: DocumentSourceDescriptor
}

export interface DocumentSourceResolver {
	resolve(
		source: DocumentSourceDescriptor,
		executionEnvironment: ExecutionEnvironment
	): Promise<DocumentSource>
}

export interface DocumentExecutionHost {
	readonly executionEnvironment: ExecutionEnvironment
	start(request: DocumentRunStartRequest): Promise<ArtifactProcessingPresentation>
	status(artifactId: string): ArtifactProcessingPresentation | undefined
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void
}

/**
 * Host adapter for the current document coordinator. The request and response
 * cross a strict JSON round trip even when the host is in-process, preserving
 * the seam that the remote server implementation will later occupy.
 */
export class InProcessDocumentExecutionHost implements DocumentExecutionHost {
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(
		readonly executionEnvironment: ExecutionEnvironment,
		private readonly runtime: DocumentProcessingRuntime,
		private readonly sources: DocumentSourceResolver
	) {
		this.runtime.onChange = (artifactId, presentation) => {
			this.onChange?.(artifactId, portableRunClone(presentation))
		}
	}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		const presentation = this.runtime.status(artifactId)
		return presentation ? portableRunClone(presentation) : undefined
	}

	async start(request: DocumentRunStartRequest): Promise<ArtifactProcessingPresentation> {
		const admitted = portableRunClone(request)
		if (admitted.protocol !== DOCUMENT_INGEST_RUN_PROTOCOL) {
			throw new Error(`unsupported document run protocol ${admitted.protocol}`)
		}
		if (admitted.executionEnvironment !== this.executionEnvironment) {
			throw new Error(
				`document host ${this.executionEnvironment} cannot execute ${admitted.executionEnvironment} run`
			)
		}
		const source = await this.sources.resolve(admitted.source, this.executionEnvironment)
		return portableRunClone(await this.runtime.start(source))
	}
}

/** Captures placement once and routes the whole run to exactly one host. */
export class DocumentExecutionRouter {
	readonly #hosts: Record<ExecutionEnvironment, DocumentExecutionHost>
	readonly #placements = new Map<string, ExecutionEnvironment>()
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(hosts: Record<ExecutionEnvironment, DocumentExecutionHost>) {
		this.#hosts = hosts
		for (const host of Object.values(hosts)) {
			host.onChange = (artifactId, presentation) => this.onChange?.(artifactId, presentation)
		}
	}

	executionEnvironment(artifactId: string): ExecutionEnvironment | undefined {
		return this.#placements.get(artifactId)
	}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		const environment = this.#placements.get(artifactId)
		return environment ? this.#hosts[environment].status(artifactId) : undefined
	}

	start(request: DocumentRunStartRequest): Promise<ArtifactProcessingPresentation> {
		const artifactId = request.source.artifactId
		const existing = this.#placements.get(artifactId)
		if (existing && existing !== request.executionEnvironment) {
			throw new Error(
				`document run placement is frozen as ${existing}; cannot restart it as ${request.executionEnvironment}`
			)
		}
		this.#placements.set(artifactId, request.executionEnvironment)
		return this.#hosts[request.executionEnvironment].start(request)
	}
}

export function documentRunStartRequest(
	source: DocumentSourceDescriptor,
	executionEnvironment: ExecutionEnvironment,
	requestId = crypto.randomUUID()
): DocumentRunStartRequest {
	return {
		protocol: DOCUMENT_INGEST_RUN_PROTOCOL,
		skillRef: DOCUMENT_INGEST_SKILL,
		requestId,
		idempotencyKey: `${source.artifactId}:document-ingest-v1`,
		requestedAt: new Date().toISOString(),
		executionEnvironment,
		source
	}
}
