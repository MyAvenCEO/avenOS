import { type ExecutionEnvironment, MessageBus } from '@avenos/actors'
import type {
	ArtifactProcessingPresentation,
	ArtifactProcessingStage,
	ClientArtifactDraft,
	ClientArtifactGateway,
	ClientRunInput,
	DerivedArtifact,
	PublishedClientArtifact
} from '@avenos/artifact-store'
import type {
	DocumentActorResult,
	DocumentActors,
	DocumentSource,
	ExtractedPage,
	PageClassification
} from './actors'
import { extractedPageFrom, pageClassificationFrom, parseDocumentActorResult } from './actors'
import type { DocumentModelStatus } from './model'
import { MAX_MODEL_PAGES } from './model'
import { documentArtifactInputRole } from './shared'

export type {
	ClientArtifactGateway,
	ClientRunInput,
	ClientRunPublication,
	PublishedClientArtifact,
	PublishedClientRun
} from '@avenos/artifact-store'

interface MaterializedArtifact extends PublishedClientArtifact {
	typeKey: string
	payload: Record<string, unknown>
	blob?: ClientArtifactDraft['blob']
}

const input = (artifactId: string, role: string, ordinal = 0): ClientRunInput => ({
	artifactId,
	role,
	ordinal
})

function artifactInputs(artifacts: MaterializedArtifact[]): ClientRunInput[] {
	const ordinals = new Map<string, number>()
	return artifacts.map((artifact) => {
		const role = documentArtifactInputRole(artifact.typeKey, artifact.payload)
		const ordinal = ordinals.get(role) ?? 0
		ordinals.set(role, ordinal + 1)
		return input(artifact.artifactId, role, ordinal)
	})
}

async function stableUuid(seed: string): Promise<string> {
	const digest = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
	)
	const bytes = digest.slice(0, 16)
	// UUIDv8 is the standards-defined space for application-specific UUID derivation.
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
			payload: draft.payload,
			...(draft.blob && { blob: draft.blob })
		}
	})
}

function pageNumber(artifact: MaterializedArtifact): number {
	const value = artifact.payload.sourcePage
	if (typeof value !== 'number') throw new Error('page artifact has no sourcePage')
	return value
}

const RETRYABLE_MODEL_METHODS = new Set([
	'document_analyze_page',
	'document_classify_kind',
	'document_extract_invoice',
	'document_extract_statement'
])
const MODEL_RETRY_DELAYS_MS = [500, 1000] as const

const wait = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds))

export interface DocumentProcessingRuntimeOptions {
	executionEnvironment?: ExecutionEnvironment
	/** Describes the current adapter, not the eventual physical server location. */
	runtimeHost?: 'desktop' | 'in-process-server-emulation' | 'server'
}

/**
 * Client-owned coordinator. Actors perform every transformation; this class
 * only advances the durable DAG and binds published artifact IDs to the next
 * envelope. Re-running uses the same derived publication UUIDs, so a crash is
 * a replay rather than a duplicate derivation.
 */
export class DocumentProcessingRuntime {
	readonly #bus: MessageBus
	readonly #gateway: ClientArtifactGateway
	readonly #modelEnabled: boolean
	readonly #modelStatus?: () => Promise<DocumentModelStatus>
	readonly #options: Required<DocumentProcessingRuntimeOptions>
	readonly #presentations = new Map<string, ArtifactProcessingPresentation>()
	readonly #running = new Map<string, Promise<ArtifactProcessingPresentation>>()
	onChange?: (artifactId: string, presentation: ArtifactProcessingPresentation) => void

	constructor(
		actors: DocumentActors,
		gateway: ClientArtifactGateway,
		modelStatus?: () => Promise<DocumentModelStatus>,
		options: DocumentProcessingRuntimeOptions = {}
	) {
		this.#bus = new MessageBus()
		for (const actor of actors.all) this.#bus.register(actor)
		this.#gateway = gateway
		this.#modelEnabled = Boolean(actors.analyzePage && actors.classifyDocument)
		this.#modelStatus = modelStatus
		this.#options = {
			executionEnvironment: options.executionEnvironment ?? 'local',
			runtimeHost: options.runtimeHost ?? 'desktop'
		}
	}

	status(artifactId: string): ArtifactProcessingPresentation | undefined {
		return this.#presentations.get(artifactId)
	}

	start(source: DocumentSource): Promise<ArtifactProcessingPresentation> {
		const active = this.#running.get(source.artifactId)
		if (active) return active
		const existing = this.#presentations.get(source.artifactId)
		if (existing && (existing.state === 'succeeded' || existing.state === 'needs_review')) {
			return Promise.resolve(existing)
		}
		const running = this.#run(source).finally(() => this.#running.delete(source.artifactId))
		this.#running.set(source.artifactId, running)
		return running
	}

	async #run(source: DocumentSource): Promise<ArtifactProcessingPresentation> {
		const presentation: ArtifactProcessingPresentation = {
			caseId: await stableUuid(`${source.artifactId}:client-document-case-v1`),
			state: 'active',
			projectionVersion: 'client-actor-document-v1',
			preferredType: 'file',
			label: source.originalName,
			summary: null,
			metadata: {
				execution: 'actors',
				executionEnvironment: this.#options.executionEnvironment,
				runtimeHost: this.#options.runtimeHost
			},
			warnings: [],
			stages: [],
			derivedArtifacts: []
		}
		this.#presentations.set(source.artifactId, presentation)
		this.#changed(source.artifactId, presentation)
		let currentStage = 'inspect'
		try {
			const modelStatus: DocumentModelStatus = this.#modelStatus
				? await this.#modelStatus().catch(() => ({ available: false, maxPages: MAX_MODEL_PAGES }))
				: { available: false, maxPages: MAX_MODEL_PAGES }
			const modelPageLimit =
				modelStatus.available && Number.isInteger(modelStatus.maxPages) && modelStatus.maxPages >= 1
					? Math.min(MAX_MODEL_PAGES, modelStatus.maxPages)
					: 0
			if (modelStatus.modelId) presentation.metadata.modelId = modelStatus.modelId
			if (modelStatus.modelLabel) presentation.metadata.modelLabel = modelStatus.modelLabel
			if (modelStatus.alternatives) {
				presentation.metadata.modelAlternatives = modelStatus.alternatives
			}
			const inspected = await this.#step(source, presentation, {
				key: 'inspect',
				method: 'document_inspect',
				payload: {
					source,
					modelPageLimit
				},
				inputs: [input(source.artifactId, 'source')],
				dependsOn: []
			})
			const document = inspected.result.document
			if (!document) throw new Error('inspector omitted the decoded document')
			if (document.outcome !== 'ok') {
				presentation.state = 'needs_review'
				presentation.preferredType = document.detectedMediaType
				presentation.summary = `The file is ${document.outcome}; client processing stopped safely.`
				presentation.warnings.push({
					code: `file-${document.outcome}`,
					message: presentation.summary,
					retryable: false
				})
				this.#changed(source.artifactId, presentation)
				return presentation
			}

			currentStage = 'decompose-pages'
			const decomposed = await this.#step(source, presentation, {
				key: currentStage,
				method: 'document_decompose',
				payload: { document },
				inputs: [
					input(source.artifactId, 'source'),
					input(inspected.artifacts[0]?.artifactId ?? '', 'inspection')
				],
				dependsOn: ['inspect']
			})
			const pageArtifacts = decomposed.artifacts
				.filter((artifact) => artifact.typeKey === 'docs.page')
				.sort((left, right) => pageNumber(left) - pageNumber(right))
			const nativePages: ExtractedPage[] = []
			let extractedPages: ExtractedPage[] = []
			const pageClassifications: PageClassification[] = []
			const nativeArtifacts: MaterializedArtifact[] = []
			let representationArtifacts: MaterializedArtifact[] = []
			const classificationArtifacts: MaterializedArtifact[] = []
			const nativeByPage = new Map<number, MaterializedArtifact[]>()
			const useModel =
				this.#modelEnabled && modelStatus.available && pageArtifacts.length <= modelPageLimit
			presentation.metadata.vision = useModel ? 'model' : 'deterministic-fallback'
			if (this.#modelEnabled && modelStatus.available && !useModel) {
				presentation.warnings.push({
					code: 'client-vision-page-limit',
					message: `Vision processing admits at most ${modelPageLimit} pages; deterministic extraction continues.`,
					retryable: false
				})
			}

			for (const [index, pageArtifact] of pageArtifacts.entries()) {
				const page = document.pages.find((candidate) => candidate.page === pageNumber(pageArtifact))
				if (!page) throw new Error(`decoded page ${pageNumber(pageArtifact)} is missing`)
				const suffix = String(page.page).padStart(3, '0')
				currentStage = `extract-native-page-${suffix}`
				const extracted = await this.#step(source, presentation, {
					key: currentStage,
					method: 'document_extract_native_text',
					payload: { page },
					inputs: [input(source.artifactId, 'source'), input(pageArtifact.artifactId, 'page')],
					dependsOn: ['decompose-pages'],
					parameters: { page: page.page }
				})
				nativeArtifacts.push(...extracted.artifacts)
				nativeByPage.set(page.page, extracted.artifacts)
				const extractedPage = extractedPageFrom(extracted.result, page.page)
				nativePages.push(extractedPage)

				const textArtifact = extracted.artifacts.find(
					(artifact) => artifact.typeKey === 'docs.extracted-text'
				)
				if (!textArtifact) throw new Error('native extraction omitted text artifact')
				if (!useModel) {
					currentStage = `classify-page-${suffix}`
					const classified = await this.#step(source, presentation, {
						key: currentStage,
						method: 'document_classify_page',
						payload: {
							page,
							extracted: extractedPage,
							mediaType: document.detectedMediaType
						},
						inputs: [
							input(source.artifactId, 'source'),
							input(pageArtifact.artifactId, 'page'),
							input(textArtifact.artifactId, 'text')
						],
						dependsOn: [`extract-native-page-${suffix}`],
						parameters: { page: page.page }
					})
					classificationArtifacts.push(...classified.artifacts)
					pageClassifications.push(pageClassificationFrom(classified.result, page.page))
				}
				if (index === pageArtifacts.length - 1)
					presentation.metadata.pageCount = pageArtifacts.length
			}

			let documentClassification: MaterializedArtifact | undefined
			if (useModel) {
				currentStage = 'classify-document'
				const classified = await this.#step(source, presentation, {
					key: currentStage,
					method: 'document_classify_kind',
					payload: { document, pages: nativePages },
					inputs: [input(source.artifactId, 'source'), ...artifactInputs(nativeArtifacts)],
					dependsOn: nativePages.map(
						(page) => `extract-native-page-${String(page.page).padStart(3, '0')}`
					)
				})
				documentClassification = classified.artifacts.find(
					(artifact) => artifact.typeKey === 'core.document-classification'
				)
				if (!documentClassification) throw new Error('document classifier omitted its output')

				for (const pageArtifact of pageArtifacts) {
					const number = pageNumber(pageArtifact)
					const page = document.pages.find((candidate) => candidate.page === number)
					const native = nativePages.find((candidate) => candidate.page === number)
					if (!page || !native) throw new Error(`page ${number} representation is missing`)
					const suffix = String(number).padStart(3, '0')
					currentStage = `analyze-page-${suffix}`
					const analyzed = await this.#step(source, presentation, {
						key: currentStage,
						method: 'document_analyze_page',
						payload: { page, extracted: native },
						inputs: [
							input(source.artifactId, 'source'),
							input(pageArtifact.artifactId, 'page'),
							...artifactInputs(nativeByPage.get(number) ?? [])
						],
						dependsOn: [`extract-native-page-${suffix}`],
						parameters: { page: number }
					})
					representationArtifacts.push(
						...analyzed.artifacts.filter((artifact) =>
							['docs.extracted-text', 'docs.text-layout'].includes(artifact.typeKey)
						)
					)
					classificationArtifacts.push(
						...analyzed.artifacts.filter(
							(artifact) => artifact.typeKey === 'core.content-classification'
						)
					)
					extractedPages.push(extractedPageFrom(analyzed.result, number))
					pageClassifications.push(pageClassificationFrom(analyzed.result, number))
				}
			} else {
				extractedPages = nativePages
				representationArtifacts = nativeArtifacts
			}

			currentStage = 'assemble-document'
			const assembled = await this.#step(source, presentation, {
				key: currentStage,
				method: 'document_assemble',
				payload: { pages: extractedPages },
				inputs: [input(source.artifactId, 'source'), ...artifactInputs(representationArtifacts)],
				dependsOn: extractedPages.map(
					(page) =>
						`${useModel ? 'analyze-page' : 'extract-native-page'}-${String(page.page).padStart(3, '0')}`
				)
			})

			currentStage = 'aggregate-content'
			const aggregated = await this.#step(source, presentation, {
				key: currentStage,
				method: 'document_aggregate_content',
				payload: { pages: pageClassifications },
				inputs: [
					input(source.artifactId, 'source'),
					...classificationArtifacts.map((artifact, index) =>
						input(artifact.artifactId, 'page-classification', index)
					),
					...artifactInputs(assembled.artifacts)
				],
				dependsOn: [
					...pageClassifications.map(
						(page) =>
							`${useModel ? 'analyze-page' : 'classify-page'}-${String(page.page).padStart(3, '0')}`
					),
					'assemble-document'
				]
			})
			const classification = aggregated.artifacts.find(
				(artifact) => artifact.typeKey === 'core.content-classification'
			)
			const contentComplete = Boolean(classification?.payload.complete)
			if (useModel && documentClassification) {
				const kind = String(documentClassification.payload.resolvedKind ?? 'unknown')
				presentation.preferredType = kind
				presentation.metadata.documentKind = kind
				if (kind === 'unknown') {
					presentation.state = 'needs_review'
					presentation.summary = String(
						documentClassification.payload.reason ?? 'Unknown document kind.'
					)
					presentation.warnings.push({
						code: 'document-kind-unknown',
						message: presentation.summary,
						retryable: false
					})
				} else {
					const invoiceKinds = [
						'invoice',
						'credit-note',
						'receipt',
						'self-issued-receipt',
						'mandate',
						'order-confirmation',
						'offer',
						'reminder'
					]
					const invoice = invoiceKinds.includes(kind)
					currentStage = invoice ? 'extract-invoice' : 'extract-statement'
					const extraction = await this.#step(source, presentation, {
						key: currentStage,
						method: invoice ? 'document_extract_invoice' : 'document_extract_statement',
						payload: { document, pages: nativePages, expectedKind: kind },
						inputs: [
							input(source.artifactId, 'source'),
							input(documentClassification.artifactId, 'document-classification'),
							...artifactInputs(nativeArtifacts)
						],
						dependsOn: ['classify-document']
					})
					const candidate = extraction.artifacts.find((artifact) =>
						invoice
							? artifact.typeKey === 'bookkeeping.invoice-candidate'
							: artifact.typeKey === 'banking.account-statement-candidate'
					)
					if (!candidate) throw new Error('finance extractor omitted its candidate')
					currentStage = invoice ? 'validate-invoice' : 'validate-statement'
					const validation = await this.#step(source, presentation, {
						key: currentStage,
						method: invoice ? 'document_validate_invoice' : 'document_validate_statement',
						payload: { candidate: candidate.payload },
						inputs: [input(source.artifactId, 'source'), input(candidate.artifactId, 'candidate')],
						dependsOn: [invoice ? 'extract-invoice' : 'extract-statement']
					})
					const validationArtifact = validation.artifacts[0]
					const status = String(validationArtifact?.payload.status ?? 'incomplete')
					presentation.state = status === 'inconsistent' ? 'needs_review' : 'succeeded'
					presentation.summary = String(
						candidate.payload.summary ?? `${kind} extracted and validated.`
					)
					presentation.metadata.validationStatus = status
					if (status !== 'consistent') {
						presentation.warnings.push({
							code: `${invoice ? 'invoice' : 'statement'}-${status}`,
							message: `Finance validation reported ${status}.`,
							retryable: false
						})
					}
				}
			} else {
				presentation.state = contentComplete ? 'succeeded' : 'needs_review'
				presentation.preferredType = String(classification?.payload.primaryKind ?? 'file')
				presentation.summary = contentComplete
					? `${pageArtifacts.length} page(s) processed locally with native text extraction.`
					: `${pageArtifacts.length} page(s) preserved; OCR or visual understanding is required.`
			}
			if (!useModel && !contentComplete) {
				presentation.warnings.push({
					code: 'client-ocr-unavailable',
					message: 'No trustworthy native text was found and the vision lane was unavailable.',
					retryable: false
				})
			}
			this.#changed(source.artifactId, presentation)
			return presentation
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const stage = presentation.stages.find((candidate) => candidate.key === currentStage)
			if (stage) {
				stage.state = 'failed'
				stage.terminalCode = 'client-processing-failed'
			}
			presentation.state = 'failed'
			presentation.summary = message
			presentation.warnings.push({
				code: 'client-processing-failed',
				message,
				retryable: true
			})
			this.#changed(source.artifactId, presentation)
			return presentation
		}
	}

	async #step(
		source: DocumentSource,
		presentation: ArtifactProcessingPresentation,
		definition: {
			key: string
			method: string
			payload: Record<string, unknown>
			inputs: ClientRunInput[]
			dependsOn: string[]
			parameters?: Record<string, unknown>
		}
	): Promise<{
		result: DocumentActorResult
		artifacts: MaterializedArtifact[]
	}> {
		const stage: ArtifactProcessingStage = {
			key: definition.key,
			state: 'running',
			dependsOn: definition.dependsOn,
			attemptCount: 1
		}
		presentation.stages.push(stage)
		this.#changed(source.artifactId, presentation)
		const maximumAttempts = RETRYABLE_MODEL_METHODS.has(definition.method)
			? MODEL_RETRY_DELAYS_MS.length + 1
			: 1
		let lastError: unknown
		let result: DocumentActorResult | undefined
		for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
			stage.attemptCount = attempt
			stage.state = 'running'
			this.#changed(source.artifactId, presentation)
			try {
				const response = await this.#bus.dispatch(
					'document-runtime',
					definition.method,
					definition.payload
				)
				result = parseDocumentActorResult(response.record)
				break
			} catch (error) {
				lastError = error
				if (attempt === maximumAttempts) break
				stage.state = 'retry_wait'
				this.#changed(source.artifactId, presentation)
				await wait(MODEL_RETRY_DELAYS_MS[attempt - 1] ?? 0)
			}
		}
		if (!result) throw lastError

		stage.procedureKey = result.procedureKey
		stage.state = 'publishing'
		this.#changed(source.artifactId, presentation)
		const receipt = await this.#gateway.publish({
			publicationId: await stableUuid(
				`${source.artifactId}:${definition.key}:${result.procedureKey}:${definition.inputs
					.map((item) => `${item.role}:${item.ordinal}:${item.artifactId}`)
					.join('|')}:client-v1`
			),
			procedureKey: result.procedureKey,
			procedureVersion: 'client-v1',
			inputs: definition.inputs,
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
					typeVersion: 1,
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
