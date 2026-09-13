import {
	ACTOR_RUN_PROTOCOL,
	AVEN_CEO_AUTHORITY,
	type ExecutionEnvironment,
	type PlanRunnerClient,
	type PlanRunStartCommand,
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
	cancel?(artifactId: string): Promise<void> | void
	retry?(artifactId: string): Promise<void>
	status(artifactId: string): ArtifactProcessingPresentation | undefined
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void
}

export function documentPlanRunCommand(request: DocumentRunStartRequest): PlanRunStartCommand {
	const admitted = portableRunClone(request)
	if (admitted.executionEnvironment !== 'server') {
		throw new Error('remote document runs require server placement')
	}
	return {
		protocol: ACTOR_RUN_PROTOCOL,
		requestId: admitted.requestId,
		idempotencyKey: admitted.idempotencyKey,
		requestedAt: admitted.requestedAt,
		skillRef: admitted.skillRef,
		executionEnvironment: 'server',
		ingredients: [
			{ predicate: 'ceo.aven.docs.file(source)', artifactId: admitted.source.artifactId }
		],
		goals: [],
		goalSpec: {
			mode: 'explore',
			subject: {
				predicate: 'ceo.aven.docs.file(source)',
				artifactId: admitted.source.artifactId
			},
			factFamilies: ['ceo.aven.docs', 'ceo.aven.bookkeeping', 'ceo.aven.banking']
		},
		parameters: { source: admitted.source }
	}
}

/** Real remote host backed by the authenticated generic Plan Runner protocol. */
export class RemoteDocumentExecutionHost implements DocumentExecutionHost {
	readonly executionEnvironment = 'server' as const
	readonly #presentations = new Map<string, ArtifactProcessingPresentation>()
	readonly #running = new Map<string, Promise<ArtifactProcessingPresentation>>()
	readonly #cancelled = new Set<string>()
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(
		private readonly runner: PlanRunnerClient,
		private readonly pollIntervalMs = 1000,
		private readonly timeoutMs = 15 * 60_000
	) {}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		const presentation = this.#presentations.get(artifactId)
		return presentation ? portableRunClone(presentation) : undefined
	}

	start(request: DocumentRunStartRequest): Promise<ArtifactProcessingPresentation> {
		const artifactId = request.source.artifactId
		const active = this.#running.get(artifactId)
		if (active) return active
		this.#cancelled.delete(artifactId)
		this.#update(artifactId, {
			caseId: request.requestId,
			state: 'active',
			projectionVersion: 'actor-document-v1',
			preferredType: 'file',
			label: request.source.originalName,
			summary: 'Starting server processing.',
			metadata: {
				execution: 'actors',
				executionEnvironment: 'server',
				runtimeHost: 'actor-runner'
			},
			warnings: [],
			stages: [],
			derivedArtifacts: []
		})
		const run = this.#start(request)
			.catch((error) => {
				const current = this.#presentations.get(artifactId)
				if (current) {
					const message = error instanceof Error ? error.message : String(error)
					current.state = 'failed'
					current.summary = `Could not monitor the server run: ${message}`
					current.warnings.push({ code: 'server-monitoring-failed', message, retryable: true })
					this.#update(artifactId, current)
				}
				throw error
			})
			.finally(() => this.#running.delete(artifactId))
		this.#running.set(artifactId, run)
		return run
	}

	async cancel(artifactId: string): Promise<void> {
		this.#cancelled.add(artifactId)
		const runId = this.#presentations.get(artifactId)?.metadata.runId
		if (typeof runId === 'string') await this.runner.cancel(runId, crypto.randomUUID())
	}
	async retry(artifactId: string): Promise<void> {
		const runId = this.#presentations.get(artifactId)?.metadata.runId
		// A refused admission or monitoring failure can be reopened without retrying execution.
		if (typeof runId !== 'string') return
		const record = await this.runner.status(runId)
		if (record?.state === 'failed') {
			if (!this.runner.retry) throw new Error('The server does not support retrying this run.')
			await this.runner.retry(runId, crypto.randomUUID())
		} else if (record?.state === 'cancelled') throw new Error('This run was cancelled.')
	}

	async #start(request: DocumentRunStartRequest): Promise<ArtifactProcessingPresentation> {
		const artifactId = request.source.artifactId
		const handle = await this.runner.start(documentPlanRunCommand(request))
		if (this.#cancelled.has(artifactId)) await this.runner.cancel(handle.runId, crypto.randomUUID())
		this.#update(artifactId, {
			caseId: handle.runId,
			state: 'active',
			projectionVersion: 'actor-document-v1',
			preferredType: 'file',
			label: request.source.originalName,
			summary: 'Processing on the Actor Runner.',
			metadata: {
				execution: 'actors',
				executionEnvironment: 'server',
				runtimeHost: 'actor-runner',
				runId: handle.runId
			},
			warnings: [],
			stages: [],
			derivedArtifacts: []
		})
		let deadline = Date.now() + this.timeoutMs
		let progressRevision: number | undefined
		let polls = 0
		while (Date.now() < deadline) {
			const record = await this.runner.status(handle.runId)
			if (!record) throw new Error('the Actor Runner lost the admitted document run')
			if (record.state === 'succeeded') {
				const output = record.checkpoints.at(-1)?.output
				const presentation = documentPresentation(output?.presentation)
				this.#update(artifactId, presentation)
				return portableRunClone(presentation)
			}
			if (record.state === 'failed' || record.state === 'cancelled') {
				const message = record.failure?.message ?? `document run ${record.state}`
				const failed = this.#presentations.get(artifactId)
				if (!failed) throw new Error(message)
				failed.state = 'failed'
				failed.metadata.retryAvailable =
					record.state === 'failed' && record.failure?.code !== 'EXECUTION_UNCERTAIN'
				failed.summary = message
				failed.warnings.push({ code: 'server-processing-failed', message, retryable: false })
				this.#update(artifactId, failed)
				return portableRunClone(failed)
			}
			if (record.progress?.presentation && record.revision !== progressRevision) {
				const progress = documentPresentation(record.progress.presentation, true)
				// Until the run commits a terminal result, this is only live progress.
				progress.state = 'active'
				progress.metadata.runId = handle.runId
				this.#update(artifactId, progress)
				progressRevision = record.revision
				deadline = Date.now() + this.timeoutMs
			}
			await new Promise((resolve) =>
				setTimeout(resolve, Math.min(5000, this.pollIntervalMs * 2 ** Math.min(3, polls++)))
			)
		}
		throw new Error('document processing on the Actor Runner timed out')
	}

	#update(artifactId: string, presentation: ArtifactProcessingPresentation): void {
		const cloned = portableRunClone(presentation)
		this.#presentations.set(artifactId, cloned)
		this.onChange?.(artifactId, portableRunClone(cloned))
	}
}

function documentPresentation(value: unknown, progress = false): ArtifactProcessingPresentation {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('the Actor Runner returned no document presentation')
	}
	const presentation = portableRunClone(value) as ArtifactProcessingPresentation
	if (
		!['succeeded', 'needs_review', 'failed', ...(progress ? ['active'] : [])].includes(
			presentation.state
		) ||
		presentation.metadata?.executionEnvironment !== 'server' ||
		presentation.metadata?.runtimeHost !== 'actor-runner' ||
		!Array.isArray(presentation.stages) ||
		!Array.isArray(presentation.derivedArtifacts)
	) {
		throw new Error('the Actor Runner returned an invalid document presentation')
	}
	return presentation
}

/**
 * In-process host for the observation-solver document skill. The request and
 * response cross a strict JSON round trip, matching the remote host boundary.
 */
export class InProcessDocumentExecutionHost implements DocumentExecutionHost {
	cancel(artifactId: string): void {
		this.runtime.cancel(artifactId)
	}
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
	readonly #presentations = new Map<string, ArtifactProcessingPresentation>()
	readonly #placements = new Map<string, ExecutionEnvironment>()
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(hosts: Record<ExecutionEnvironment, DocumentExecutionHost>) {
		this.#hosts = hosts
		for (const host of Object.values(hosts)) {
			host.onChange = (artifactId, presentation) => {
				this.#presentations.set(artifactId, presentation)
				this.onChange?.(artifactId, presentation)
			}
		}
	}

	executionEnvironment(artifactId: string): ExecutionEnvironment | undefined {
		return this.#placements.get(artifactId)
	}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		const environment = this.#placements.get(artifactId)
		return (
			this.#presentations.get(artifactId) ??
			(environment ? this.#hosts[environment].status(artifactId) : undefined)
		)
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
		const active: ArtifactProcessingPresentation = {
			caseId: request.requestId,
			state: 'active',
			projectionVersion: 'actor-document-v1',
			preferredType: 'file',
			label: request.source.originalName,
			summary: 'Starting document processing.',
			metadata: { executionEnvironment: request.executionEnvironment },
			warnings: [],
			stages: [],
			derivedArtifacts: []
		}
		this.#presentations.set(artifactId, active)
		this.onChange?.(artifactId, active)
		return Promise.resolve()
			.then(() => this.#hosts[request.executionEnvironment].start(request))
			.then((presentation) => {
				this.#presentations.set(artifactId, presentation)
				this.onChange?.(artifactId, presentation)
				return presentation
			})
			.catch((error) => this.fail(request, error))
	}
	fail(request: DocumentRunStartRequest, error: unknown): ArtifactProcessingPresentation {
		const artifactId = request.source.artifactId
		const previous = this.status(artifactId)
		const message = error instanceof Error ? error.message : String(error)
		const failed: ArtifactProcessingPresentation = {
			...(previous ?? {
				caseId: request.requestId,
				projectionVersion: 'actor-document-v1',
				preferredType: 'file',
				label: request.source.originalName,
				metadata: { executionEnvironment: request.executionEnvironment },
				stages: [],
				derivedArtifacts: []
			}),
			state: 'failed',
			summary: message,
			warnings: [{ code: 'document-start-or-monitor-failed', message, retryable: true }]
		}
		this.#presentations.set(artifactId, failed)
		this.onChange?.(artifactId, failed)
		return failed
	}
	async cancel(artifactId: string): Promise<void> {
		const env = this.#placements.get(artifactId)
		if (env) await this.#hosts[env].cancel?.(artifactId)
	}
	async retry(artifactId: string): Promise<void> {
		const env = this.#placements.get(artifactId)
		if (env) await this.#hosts[env].retry?.(artifactId)
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
