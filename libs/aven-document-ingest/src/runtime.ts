import {
	type ExecutionEnvironment,
	executeObservedProgram,
	MessageBus,
	solverIdentity
} from '@avenos/actors'
import { abortable } from '@avenos/actors/abort'
import type {
	ArtifactProcessingPresentation,
	ArtifactProcessingStage,
	ClientArtifactDraft,
	ClientArtifactGateway,
	ClientRunInput,
	DerivedArtifact,
	PublishedClientArtifact
} from '@avenos/artifact-store'
import type { DocumentActorResult, DocumentActors, DocumentSource } from './actors'
import { parseDocumentActorResult } from './actors'
import { CSV_DETECTOR_VERSION, csvSourceDigest, isCsvSource } from './csv'
import { readCsvConfirmation } from './csv-confirmation'
import type { DocumentModelStatus } from './model'
import { MAX_MODEL_PAGES } from './model'
import { createDocumentSkillOperations, type DocumentStepOutcome, documentAtom } from './skill'

export type {
	ClientArtifactGateway,
	ClientRunInput,
	ClientRunPublication,
	PublishedClientArtifact,
	PublishedClientRun
} from '@avenos/artifact-store'

interface MaterializedArtifact extends PublishedClientArtifact {
	typeKey: string
	typeVersion: number
	payload: Record<string, unknown>
	blob?: ClientArtifactDraft['blob']
}

function materialize(
	drafts: ClientArtifactDraft[],
	published: PublishedClientArtifact[]
): MaterializedArtifact[] {
	return drafts.map((draft) => {
		const receipt = published.find((candidate) => candidate.localKey === draft.localKey)
		if (!receipt) throw new Error(`publication omitted ${draft.localKey}`)
		return {
			...receipt,
			typeKey: draft.typeKey,
			typeVersion: draft.typeVersion,
			payload: draft.payload,
			...(draft.blob && { blob: draft.blob })
		}
	})
}

const MODEL_RETRY_DELAYS_MS = [500, 1000] as const

const wait = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface DocumentProcessingRuntimeOptions {
	/** Bound by the trusted Studio coordinator, distinct from a source-based import retry. */
	invocationId?: string
	provenanceInputs?: import('@avenos/artifact-store').ClientRunInput[]
	executionEnvironment?: ExecutionEnvironment
	/** Physical host which owns the actors for this run. */
	runtimeHost?: 'desktop' | 'actor-runner'
	procedureVersion?: 'client-v1' | 'server-v1'
}

interface ActorLane {
	bus: MessageBus
	actors: DocumentActors
	active: number
}

/**
 * Document skill host: adapts Actor delivery, publication and the existing
 * processing presentation to the general observation solver. The skill catalog
 * owns bindings and projections; this adapter never schedules a document stage.
 */
export class DocumentProcessingRuntime {
	readonly #actors: DocumentActors
	readonly #lanes: ActorLane[] = []
	readonly #actorFactory?: () => DocumentActors
	#nextLane = 0
	readonly #gateway: ClientArtifactGateway
	readonly #modelEnabled: boolean
	readonly #modelStatus?: () => Promise<DocumentModelStatus>
	readonly #options: Required<DocumentProcessingRuntimeOptions>
	readonly #presentations = new Map<string, ArtifactProcessingPresentation>()
	readonly #controllers = new Map<string, AbortController>()
	readonly #running = new Map<string, Promise<ArtifactProcessingPresentation>>()
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(
		actors: DocumentActors,
		gateway: ClientArtifactGateway,
		modelStatus?: () => Promise<DocumentModelStatus>,
		options: DocumentProcessingRuntimeOptions = {},
		actorFactory?: () => DocumentActors
	) {
		this.#actors = actors
		this.#actorFactory = actorFactory
		this.#addLane(actors)
		this.#gateway = gateway
		this.#modelEnabled = Boolean(actors.analyzePage && actors.classifyDocument)
		this.#modelStatus = modelStatus
		this.#options = {
			invocationId: options.invocationId ?? '',
			provenanceInputs: options.provenanceInputs ?? [],
			executionEnvironment: options.executionEnvironment ?? 'local',
			runtimeHost: options.runtimeHost ?? 'desktop',
			procedureVersion: options.procedureVersion ?? 'client-v1'
		}
	}

	#addLane(actors: DocumentActors): void {
		const bus = new MessageBus()
		for (const actor of actors.all) bus.register(actor)
		this.#lanes.push({ bus, actors, active: 0 })
	}

	#selectLane(): ActorLane {
		const start = this.#nextLane++ % this.#lanes.length
		let selected = this.#lanes[start]
		if (!selected) throw new Error('Document actor lane is unavailable.')
		for (let offset = 1; offset < this.#lanes.length; offset += 1) {
			const lane = this.#lanes[(start + offset) % this.#lanes.length]
			if (!lane) throw new Error('Document actor lane is unavailable.')
			if (lane.active < selected.active) selected = lane
		}
		return selected
	}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		return this.#presentations.get(artifactId)
	}

	cancel(artifactId: string): void {
		this.#controllers.get(artifactId)?.abort(new Error('Document processing cancelled.'))
	}
	#closed = false
	async close(): Promise<void> {
		this.#closed = true
		for (const id of this.#controllers.keys()) this.cancel(id)
		await Promise.allSettled(this.#running.values())
		for (const lane of this.#lanes) for (const actor of lane.actors.all) actor.dispose()
	}
	start(source: DocumentSource): Promise<ArtifactProcessingPresentation> {
		if (this.#closed) return Promise.reject(new Error('Document runtime is closed.'))
		const active = this.#running.get(source.artifactId)
		if (active) return active
		const existing = this.#presentations.get(source.artifactId)
		if (
			!isCsvSource(source) &&
			existing &&
			(existing.state === 'succeeded' || existing.state === 'needs_review')
		) {
			return Promise.resolve(existing)
		}
		const controller = new AbortController()
		this.#controllers.set(source.artifactId, controller)
		const running = this.#run(source).finally(() => {
			this.#running.delete(source.artifactId)
			this.#controllers.delete(source.artifactId)
		})
		this.#running.set(source.artifactId, running)
		return running
	}

	async #run(source: DocumentSource): Promise<ArtifactProcessingPresentation> {
		const presentation: ArtifactProcessingPresentation = {
			caseId:
				this.#options.invocationId ||
				(await solverIdentity(`${source.artifactId}:document-skill-v2`)),
			state: 'active',
			projectionVersion: 'actor-document-v1',
			preferredType: 'file',
			label: source.originalName,
			summary: null,
			metadata: {
				execution: 'actors',
				planner: 'general-observation-solver',
				executionEnvironment: this.#options.executionEnvironment,
				runtimeHost: this.#options.runtimeHost
			},
			warnings: [],
			stages: [],
			derivedArtifacts: []
		}
		this.#presentations.set(source.artifactId, presentation)
		this.#changed(source.artifactId, presentation)
		try {
			const csv = isCsvSource(source)
			const csvDigest = csv ? await csvSourceDigest(source) : null
			const csvConfirmation = csv
				? await readCsvConfirmation(this.#gateway, source.artifactId, csvDigest!)
				: null
			const model: DocumentModelStatus =
				this.#modelStatus && !csv
					? await abortable(
							this.#modelStatus().catch(() => ({ available: false, maxPages: MAX_MODEL_PAGES })),
							this.#controllers.get(source.artifactId)!.signal
						)
					: { available: false, maxPages: MAX_MODEL_PAGES }
			const modelPageLimit =
				model.available && Number.isInteger(model.maxPages) && model.maxPages >= 1
					? Math.min(MAX_MODEL_PAGES, model.maxPages)
					: 0
			if (model.modelId) presentation.metadata.modelId = model.modelId
			if (model.modelLabel) presentation.metadata.modelLabel = model.modelLabel
			if (model.alternatives) presentation.metadata.modelAlternatives = model.alternatives
			const operations = createDocumentSkillOperations({
				source,
				actors: this.#actors,
				modelPageLimit
			})
			const results = new Map<string, DocumentStepOutcome>()
			const parallelism = model.available ? Math.min(32, Math.max(1, model.maxParallelism ?? 1)) : 1
			while (this.#actorFactory && this.#lanes.length < parallelism)
				this.#addLane(this.#actorFactory())
			const run = await executeObservedProgram({
				maxInvocations: 100_000,
				maxParallelism: this.#actorFactory ? parallelism : 1,
				runId:
					presentation.caseId +
					':' +
					this.#options.procedureVersion +
					':model-pages-' +
					modelPageLimit,
				operations,
				ingredients: [
					{
						id: source.artifactId,
						predicate: `ceo.aven.docs.file(${documentAtom(source.artifactId)})`,
						value: { artifactId: source.artifactId }
					},
					...(csvConfirmation?.payload.decision === 'accepted'
						? [
								{
									id: csvConfirmation.artifactId,
									predicate: `ceo.aven.banking.csv_confirmed(${documentAtom(source.artifactId)}, ${documentAtom(csvConfirmation.payload.detectionArtifactId)}, ${documentAtom(csvConfirmation.artifactId)})`,
									value: csvConfirmation
								}
							]
						: [])
				],
				port: {
					lookup: async () => null,
					invoke: async (invocation) => {
						const operation = operations.find((item) => item.id === invocation.operation)!
						const definition = operation.prepare(invocation)
						const dependsOn = [
							...new Set(
								[...invocation.inputs, ...Object.values(invocation.gathers).flat()].flatMap(
									(fact) => {
										const stage = (fact.value as Partial<DocumentStepOutcome>)?.stageKey
										return stage ? [stage] : []
									}
								)
							)
						]
						let result: DocumentStepOutcome
						try {
							const executed = await this.#step(source, presentation, {
								...definition,
								actor: operation.actor,
								dependsOn,
								publicationId: invocation.id
							})
							result = { ...executed, stageKey: definition.key }
						} catch (error) {
							this.#controllers.get(source.artifactId)!.signal.throwIfAborted()
							// An uncertain publication is not a negative observation about a document.
							const stage = presentation.stages.find((item) => item.key === definition.key)
							if (stage?.state === 'publishing') throw error
							if (stage) {
								stage.state = 'failed'
								stage.terminalCode = 'actor-invocation-failed'
							}
							const message = error instanceof Error ? error.message : String(error)
							presentation.warnings.push({
								code: `${definition.key}-failed`,
								message,
								retryable: true
							})
							return {
								invocationId: invocation.id,
								operation: operation.id,
								state: 'failed',
								error: message,
								facts: operation.projectFailure?.(invocation) ?? []
							}
						}
						results.set(definition.key, result)
						return {
							invocationId: invocation.id,
							operation: operation.id,
							state: 'succeeded',
							facts: operation.project(result, invocation)
						}
					}
				}
			})
			const artifacts = [...results.values()].flatMap((result) => result.artifacts)
			const csvDetection = artifacts.find((a) => a.typeKey === 'banking.csv-statement-detection')
			if (
				csvDetection &&
				(csvDetection.payload.sourceArtifactId !== source.artifactId ||
					csvDetection.payload.sourceSha256 !== csvDigest ||
					csvDetection.payload.detectorVersion !== CSV_DETECTOR_VERSION)
			)
				throw new Error(
					'Committed CSV detection differs from the current source or detector revision.'
				)
			const inspection = artifacts.find(
				(artifact) => artifact.typeKey === 'core.file-inspection'
			)?.payload
			const pageCount = Number(inspection?.pageCount ?? 0)
			presentation.metadata.pageCount = pageCount
			presentation.metadata.chunkCount = pageCount
			presentation.metadata.completedChunks = presentation.stages.filter(
				(stage) => stage.key.startsWith('extract-native-page-') && stage.state === 'succeeded'
			).length
			const useModel =
				this.#modelEnabled &&
				modelPageLimit > 0 &&
				pageCount > 0 &&
				Boolean(
					results
						.get('inspect')
						?.result.document?.pages.every(
							(page) => page.deferred || page.image || page.runs.length
						)
				)
			presentation.metadata.vision = useModel ? 'model' : 'deterministic-fallback'
			const finalArtifacts = [
				...(results.get('classify-document')?.artifacts ?? []),
				...(results.get('extract-invoice')?.artifacts ?? []),
				...(results.get('extract-statement')?.artifacts ?? [])
			]
			const kind = finalArtifacts.find(
				(artifact) => artifact.typeKey === 'core.document-classification'
			)?.payload
			const content = artifacts.find(
				(artifact) =>
					artifact.typeKey === 'core.content-classification' &&
					artifact.payload.subjectLevel === 'file'
			)?.payload
			const validation = artifacts.find((artifact) =>
				['bookkeeping.invoice-validation', 'banking.statement-validation'].includes(
					artifact.typeKey
				)
			)?.payload
			const candidate = finalArtifacts.find((artifact) =>
				['bookkeeping.invoice-candidate', 'banking.account-statement-candidate'].includes(
					artifact.typeKey
				)
			)?.payload
			if (
				candidate &&
				Array.isArray(candidate.transactions) &&
				((!candidate.chunkCoverage && candidate.transactions.length >= 128) ||
					String(candidate.notes ?? '').startsWith('[ROW_LIMIT_REACHED]') ||
					(candidate.chunkCoverage as { complete?: boolean } | undefined)?.complete === false)
			) {
				presentation.metadata.statementOverflow = true
				presentation.warnings.push({
					code: 'statement-row-limit',
					message:
						'Some extraction chunks have incomplete coverage or conflicting values. Review the retained source chunks before using the combined statement.',
					retryable: false
				})
			}
			if (candidate)
				for (const key of [
					'supplier',
					'invoiceNumber',
					'grossMinor',
					'currency',
					'accountHolder',
					'periodStart',
					'periodEnd',
					'closingBalanceMinor'
				]) {
					const value = candidate[key]
					if (typeof value === 'string' || typeof value === 'number')
						presentation.metadata[key] = value
				}
			if (!inspection) {
				presentation.state = 'failed'
				presentation.summary =
					'Document inspection failed; no conclusion about its contents was made.'
				presentation.metadata.failedActorCount = presentation.stages.filter(
					(stage) => stage.state === 'failed'
				).length
			} else if (inspection.outcome !== 'ok') {
				presentation.state = 'needs_review'
				presentation.preferredType = String(inspection.detectedMediaType)
				presentation.summary = `The file is ${inspection.outcome}; processing stopped safely.`
				presentation.warnings.push({
					code: `file-${inspection.outcome}`,
					message: presentation.summary,
					retryable: false
				})
			} else {
				presentation.preferredType = String(kind?.resolvedKind ?? content?.primaryKind ?? 'file')
				if (kind) presentation.metadata.documentKind = String(kind.resolvedKind)
				if (validation) {
					presentation.metadata.validationStatus = String(validation.status)
					presentation.summary = String(
						candidate?.summary ?? 'Finance document extracted and validated.'
					)
					if (validation.status !== 'consistent')
						presentation.warnings.push({
							code: `finance-${validation.status}`,
							message: `Finance validation reported ${validation.status}.`,
							retryable: false
						})
				} else
					presentation.summary =
						kind?.resolvedKind === 'unknown'
							? String(kind.reason)
							: content?.complete
								? `${pageCount} page(s) processed with native text extraction.`
								: `${pageCount} page(s) preserved; OCR or visual understanding is required.`
				const failures = presentation.stages.filter((stage) => stage.state === 'failed')
				if (failures.length) presentation.metadata.failedActorCount = failures.length
				presentation.state =
					run.state === 'complete' &&
					!presentation.metadata.statementOverflow &&
					content?.complete &&
					kind?.resolvedKind !== 'unknown' &&
					(!validation || validation.status === 'consistent')
						? 'succeeded'
						: 'needs_review'
				if (!inspection || (!content && failures.length && !useModel)) presentation.state = 'failed'
				if (!useModel && !content?.complete)
					presentation.warnings.push({
						code: 'client-ocr-unavailable',
						message: 'No trustworthy native text was found and the vision lane was unavailable.',
						retryable: false
					})
				if (kind?.resolvedKind === 'unknown')
					presentation.warnings.push({
						code: 'document-kind-unknown',
						message: presentation.summary ?? 'Unknown document kind.',
						retryable: false
					})
			}
			if (csv) {
				presentation.metadata.csvDetectionArtifactId = csvDetection?.artifactId ?? null
				presentation.metadata.csvDetection = csvDetection?.payload ?? null
				presentation.metadata.csvDocumentConfirmation =
					csvConfirmation?.payload.decision ?? 'required'
				presentation.metadata.documentKind =
					csvConfirmation?.payload.decision === 'accepted' ? 'bank-statement' : 'unconfirmed-csv'
				if (
					csvDetection?.payload.eligible !== true ||
					csvConfirmation?.payload.decision !== 'accepted'
				) {
					presentation.state = 'needs_review'
					presentation.summary =
						csvConfirmation?.payload.decision === 'rejected'
							? 'CSV document type was rejected. No bookings admitted.'
							: String(
									csvDetection?.payload.reason ?? 'CSV detection failed. No bookings admitted.'
								)
				}
			}
		} catch (error) {
			presentation.state = 'failed'
			presentation.summary = error instanceof Error ? error.message : String(error)
			presentation.warnings.push({
				code: 'client-processing-failed',
				message: presentation.summary,
				retryable: true
			})
		}
		this.#changed(source.artifactId, presentation)
		return presentation
	}
	async #step(
		source: DocumentSource,
		presentation: ArtifactProcessingPresentation,
		definition: {
			key: string
			actor: string
			method: string
			payload: Record<string, unknown>
			inputs: ClientRunInput[]
			dependsOn: string[]
			parameters?: Record<string, unknown>
			publicationId: string
			maximumAttempts?: number
		}
	): Promise<{
		result: DocumentActorResult
		artifacts: MaterializedArtifact[]
	}> {
		const signal = this.#controllers.get(source.artifactId)!.signal
		signal.throwIfAborted()
		const stage: ArtifactProcessingStage = {
			key: definition.key,
			state: 'running',
			dependsOn: definition.dependsOn,
			attemptCount: 1
		}
		presentation.stages.push(stage)
		this.#changed(source.artifactId, presentation)
		if (definition.publicationId && this.#gateway.lookup) {
			// Read through the authoritative customer store before re-running any Actor.
			// Lookup failures are not absence and must not trigger a fresh model call.
			stage.state = 'publishing'
			const committed = await this.#gateway.lookup(definition.publicationId)
			if (committed) {
				if (committed.procedureVersion !== this.#options.procedureVersion)
					throw new Error('committed procedure version differs from the admitted run')
				const result: DocumentActorResult = {
					ok: true,
					procedureKey: committed.procedureKey,
					artifacts: committed.artifacts,
					evidence: []
				}
				const inspection = committed.artifacts.find(
					(artifact) => artifact.typeKey === 'core.file-inspection'
				)
				if (inspection) {
					if (!inspection.blob)
						throw new Error('committed inspection has no durable decoded representation')
					const bytes = Uint8Array.from(atob(inspection.blob.base64), (character) =>
						character.charCodeAt(0)
					)
					const document = JSON.parse(
						new TextDecoder().decode(bytes)
					) as DocumentActorResult['document']
					if (
						!document ||
						document.outcome !== inspection.payload.outcome ||
						document.pages.length !== inspection.payload.pageCount
					)
						throw new Error('committed decoded representation contradicts its inspection')
					result.document = document
				}
				const artifacts = materialize(result.artifacts, committed.receipt.artifacts)
				stage.state = 'succeeded'
				stage.attemptCount = 0
				stage.procedureKey = result.procedureKey
				presentation.derivedArtifacts.push(
					...artifacts.map((artifact) => ({
						artifactId: artifact.artifactId,
						typeKey: artifact.typeKey,
						typeVersion: artifact.typeVersion,
						stageKey: definition.key
					}))
				)
				this.#changed(source.artifactId, presentation)
				return { result, artifacts }
			}
			stage.state = 'running'
		}
		const maximumAttempts = definition.maximumAttempts ?? 1
		let lastError: unknown
		let result: DocumentActorResult | undefined
		for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
			stage.attemptCount = attempt
			stage.state = 'running'
			this.#changed(source.artifactId, presentation)
			try {
				signal.throwIfAborted()
				const lane = this.#selectLane()
				lane.active += 1
				const delivery = lane.bus.send({
					id: definition.publicationId,
					from: 'document-runtime',
					to: definition.actor,
					method: definition.method,
					payload: { ...definition.payload, source }
				})
				const response = await abortable(
					delivery.finally(() => {
						lane.active -= 1
					}),
					signal
				)
				signal.throwIfAborted()
				result = parseDocumentActorResult(response.record)
				break
			} catch (error) {
				lastError = error
				stage.lastError = error instanceof Error ? error.message : String(error)
				if (
					signal.aborted ||
					!(error as { retryable?: boolean })?.retryable ||
					attempt === maximumAttempts
				)
					break
				stage.state = 'retry_wait'
				this.#changed(source.artifactId, presentation)
				await wait(MODEL_RETRY_DELAYS_MS[attempt - 1] ?? 0)
			}
		}
		if (!result) throw lastError
		delete stage.lastError

		stage.procedureKey = result.procedureKey
		stage.state = 'publishing'
		this.#changed(source.artifactId, presentation)
		signal.throwIfAborted()
		const receipt = await this.#gateway.publish({
			publicationId: definition.publicationId,
			procedureKey: result.procedureKey,
			procedureVersion: this.#options.procedureVersion,
			inputs: [...definition.inputs, ...this.#options.provenanceInputs],
			parameters: {
				...(definition.parameters ?? {}),
				...(result.modelReceipt && { modelReceipt: result.modelReceipt })
			},
			artifacts: result.artifacts,
			evidence: result.evidence
		})
		const artifacts = materialize(result.artifacts, receipt.artifacts)
		stage.state = 'succeeded'
		presentation.derivedArtifacts.push(
			...artifacts.map(
				(artifact): DerivedArtifact => ({
					artifactId: artifact.artifactId,
					typeKey: artifact.typeKey,
					typeVersion: artifact.typeVersion,
					stageKey: definition.key
				})
			)
		)
		this.#changed(source.artifactId, presentation)
		return { result, artifacts }
	}

	#changed(artifactId: string, presentation: ArtifactProcessingPresentation): void {
		this.onChange?.(artifactId, structuredClone(presentation))
	}
}
