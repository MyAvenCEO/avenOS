/// <reference path="./pdfjs-worker.d.ts" />

import {
	base64Length,
	boundedBase64,
	boundedImage,
	decodePlainText,
	isPdf,
	jpegDimensions,
	jpegVisualBytes,
	MAX_FILE_BYTES,
	MAX_RENDER_BYTES,
	normalizedRun,
	normalizeRotation,
	pngDimensions,
	renderScale
} from './decoding'
import { DOCUMENT_PROCEDURES } from './provenance'

// Initialization barrier: PDF.js evaluates DOMMatrix during module loading.
import './server-pdf-canvas'

import type { PlanRunExecutor, PlanRunStartRequest } from '@avenos/actors'
import { ACTOR_RUN_PROTOCOL, portableRunClone } from '@avenos/actors'
import type {
	ArtifactJson,
	ArtifactProcessingPresentation,
	ArtifactStoreClient,
	ClientRunPublication,
	PublishedClientRun
} from '@avenos/artifact-store'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs'
import { createDocumentActors } from './actors/registry'
import { DOCUMENT_INGEST_SKILL, type DocumentSourceDescriptor } from './execution'
import type { DocumentModelGateway } from './model'
import { readPdfTextContent } from './pdf-text'
import {
	RECONCILIATION_GOAL,
	RECONCILIATION_SKILL,
	type ReconciliationArtifact,
	type ReconciliationArtifactPage,
	type ReconciliationGateway,
	reconcileInvoices
} from './reconciliation-flow'
import { DocumentProcessingRuntime } from './runtime'
import { createCanvas, ServerPdfCanvasFactory } from './server-pdf-canvas'
import {
	type DecodedDocument,
	type DecodedPage,
	DOCUMENT_SCHEMA_BINDINGS,
	type DocumentDecodeOptions,
	type DocumentDecoder,
	type DocumentSource,
	MAX_DOCUMENT_PAGES,
	pdfDecodeFailureKind
} from './shared'

// PDF.js uses a same-process "fake worker" in Bun/Node. Its default loader is
// a runtime import of ./pdf.worker.mjs, which disappears when Actor Runner is
// bundled into one production file. Bind the handler explicitly so Bun keeps
// it in the bundle and PDF decoding does not depend on a sibling module that
// the runtime image intentionally does not ship.
const pdfjsGlobal = globalThis as typeof globalThis & {
	pdfjsWorker?: { WorkerMessageHandler: unknown }
}
pdfjsGlobal.pdfjsWorker ??= { WorkerMessageHandler }

/** Artifact Store route selected from an already verified customer grant. */
export interface DocumentArtifactStoreRoute {
	client: ArtifactStoreClient
	scopeId: string
	userId: string
}

export interface DocumentSkillExecutorDependencies {
	/** Trusted host binding; never populated from caller-supplied parameters. */
	provenanceFor?(request: PlanRunStartRequest): {
		invocationId: string
		inputs: import('@avenos/artifact-store').ClientRunInput[]
	}
	artifactsFor(
		request: PlanRunStartRequest
	): DocumentArtifactStoreRoute | Promise<DocumentArtifactStoreRoute>
	decoder?: DocumentDecoder
	model?: DocumentModelGateway
}

/** Production executor for the application-owned document-ingest skill. */
export function createDocumentSkillExecutor(
	dependencies: DocumentSkillExecutorDependencies
): PlanRunExecutor {
	return async (request, context) => {
		assertDocumentCommand(request)
		const route = await dependencies.artifactsFor(request)
		if (route.scopeId !== request.security.access.tenantId) {
			throw new Error('document Artifact Store route does not match the admitted tenant')
		}
		const descriptor = sourceDescriptor(request.parameters.source)
		const ingredient = request.ingredients[0]
		if (
			request.ingredients.length !== 1 ||
			ingredient?.artifactId !== descriptor.artifactId ||
			ingredient.predicate !== 'ceo.aven.docs.file(source)'
		) {
			throw new Error('document command does not bind its source artifact')
		}
		const envelope = object(
			await route.client.artifact(route.scopeId, descriptor.artifactId),
			'source artifact'
		)
		if (envelope.typeKey !== 'core.file')
			throw new Error('document source is not a core.file artifact')
		const payload = object(envelope.payload, 'source artifact payload')
		const originalName = string(payload.originalName, 'source original name')
		const declaredMediaType = string(payload.declaredMediaType, 'source media type')
		if (
			descriptor.originalName !== originalName ||
			(descriptor.declaredMediaType && descriptor.declaredMediaType !== declaredMediaType)
		) {
			throw new Error('document command source metadata differs from the committed artifact')
		}
		const bytes = await route.client.content(route.scopeId, descriptor.artifactId)
		if (bytes.byteLength > MAX_FILE_BYTES)
			throw new Error('file exceeds the 128 MiB processing limit')
		const source: DocumentSource = {
			artifactId: descriptor.artifactId,
			originalName,
			declaredMediaType,
			base64: bytesToBase64(bytes)
		}
		const gateway = new ArtifactStoreDocumentGateway(route)
		const model = dependencies.model
			? {
					status: () => dependencies.model!.status(),
					complete: (request: import('./model').DocumentModelRequest) => {
						context?.signal?.throwIfAborted()
						return dependencies.model!.complete(request, { signal: context?.signal })
					}
				}
			: undefined
		const decoder = dependencies.decoder ?? new ServerDocumentDecoder()
		const createActors = () => createDocumentActors(decoder, model)
		const actors = createActors()
		const provenance = dependencies.provenanceFor?.(request)
		const runtime = new DocumentProcessingRuntime(
			actors,
			gateway,
			model ? () => model.status() : undefined,
			{
				...(provenance
					? {
							invocationId: provenance.invocationId,
							provenanceInputs: provenance.inputs
						}
					: {}),
				executionEnvironment: 'server',
				runtimeHost: 'actor-runner',
				procedureVersion: 'server-v1'
			},
			createActors
		)
		// Serialize status writes without turning progress into a solver fact or a
		// successful publication. Flush before returning the authoritative result.
		let progressWrites = Promise.resolve()
		let progressError: unknown
		if (context?.reportProgress)
			runtime.onChange = (_id, presentation) => {
				const snapshot = portableRunClone(presentation)
				progressWrites = progressWrites.then(async () => {
					if (progressError) return
					try {
						await context.reportProgress?.({ presentation: snapshot })
					} catch (error) {
						progressError = error
					}
				})
			}
		const cancelled = () => runtime.cancel(source.artifactId)
		context?.signal?.addEventListener('abort', cancelled, { once: true })
		context?.signal?.throwIfAborted()
		const presentation = await runtime.start(source).finally(async () => {
			context?.signal?.removeEventListener('abort', cancelled)
			await progressWrites
			for (const actor of actors.all) actor.dispose()
		})
		if (progressError) throw progressError
		if (presentation.state === 'failed') {
			throw new Error(presentation.summary ?? 'document processing failed')
		}
		return {
			artifactIds: presentation.derivedArtifacts.map((artifact) => artifact.artifactId),
			completedStepIds: presentation.stages
				.filter((stage) => stage.state === 'succeeded')
				.map((stage) => stage.key),
			remainingGoals: [],
			registryRevision: 0,
			policyDecisionIds: ['document-ingest:tenant-source-bound'],
			output: {
				kind: 'artifact-understanding',
				status: presentation.state === 'succeeded' ? 'complete' : 'partial',
				stoppingReason: presentation.state === 'succeeded' ? 'saturated' : 'needs_review',
				subjectArtifactId: descriptor.artifactId,
				facts: [
					{ predicate: 'ceo.aven.docs.file(source)', artifactId: descriptor.artifactId },
					...presentation.derivedArtifacts.flatMap(factForArtifact)
				],
				affordances: [],
				presentation: portableRunClone(presentation)
			}
		}
	}
}

function assertDocumentCommand(request: PlanRunStartRequest): void {
	if (request.protocol !== ACTOR_RUN_PROTOCOL) throw new Error('unsupported Actor Runner protocol')
	if (request.skillRef !== DOCUMENT_INGEST_SKILL) throw new Error('unsupported document skill')
	if (request.executionEnvironment !== 'server')
		throw new Error('document skill requires server placement')
	if (!request.security.access.tenantId)
		throw new Error('document skill requires a customer tenant')
	const exploration =
		request.goals.length === 0 &&
		request.goalSpec?.mode === 'explore' &&
		request.goalSpec.subject.artifactId === request.ingredients[0]?.artifactId
	if (!exploration) {
		throw new Error('document command has an invalid goal')
	}
}

function bindingForType(typeKey: string, stageKey: string) {
	if (stageKey.startsWith('assemble-document') && typeKey === 'docs.extracted-text') {
		return [
			'ceo.aven.docs.document_text',
			DOCUMENT_SCHEMA_BINDINGS['ceo.aven.docs.document_text']
		] as const
	}
	if (stageKey.startsWith('assemble-document') && typeKey === 'docs.text-layout') {
		return [
			'ceo.aven.docs.document_layout',
			DOCUMENT_SCHEMA_BINDINGS['ceo.aven.docs.document_layout']
		] as const
	}
	return Object.entries(DOCUMENT_SCHEMA_BINDINGS).find(([, binding]) => binding.typeKey === typeKey)
}

function factForArtifact(artifact: {
	artifactId: string
	typeKey: string
	stageKey: string
}): Array<{ predicate: string; artifactId: string; schema: string }> {
	const binding = bindingForType(artifact.typeKey, artifact.stageKey)
	const schema = binding?.[1]?.schema
	if (!binding || !schema) return []
	return [{ predicate: binding[0], artifactId: artifact.artifactId, schema }]
}

function sourceDescriptor(value: unknown): DocumentSourceDescriptor {
	const source = object(value, 'document source')
	const artifactId = string(source.artifactId, 'document source artifact ID')
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)
	) {
		throw new Error('document source artifact ID must be a UUID')
	}
	const originalName = string(source.originalName, 'document source original name')
	const declaredMediaType = source.declaredMediaType
	if (declaredMediaType !== undefined && typeof declaredMediaType !== 'string') {
		throw new Error('document source media type must be a string')
	}
	return { artifactId, originalName, ...(declaredMediaType && { declaredMediaType }) }
}

/** Publishes trusted server actor outputs with the same Artifact Store semantics as the local lane. */
export class ArtifactStoreDocumentGateway implements ReconciliationGateway {
	constructor(private readonly route: DocumentArtifactStoreRoute) {}

	lookup(publicationId: string) {
		return this.route.client.committedClientRun(this.route.scopeId, publicationId)
	}

	async query(query: {
		typeKey: string
		snapshotSequence?: number
		after?: string
	}): Promise<ReconciliationArtifactPage> {
		return (await this.route.client.queryArtifacts(
			this.route.scopeId,
			query
		)) as unknown as ReconciliationArtifactPage
	}

	async artifact(artifactId: string): Promise<ReconciliationArtifact> {
		return (await this.route.client.artifact(
			this.route.scopeId,
			artifactId
		)) as unknown as ReconciliationArtifact
	}

	async publish(run: ClientRunPublication): Promise<PublishedClientRun> {
		if (run.procedureVersion !== 'server-v1') throw new Error('server publication version required')
		const context = object(await this.route.client.context(), 'Artifact Store context')
		const storeEpoch = string(context.storeEpoch, 'Artifact Store epoch')
		const blobAuthorities: Record<string, ArtifactJson> = {}
		const artifacts: ArtifactJson[] = []
		for (const output of run.artifacts) {
			let blob: ArtifactJson = null
			if (output.blob) {
				const bytes = base64ToBytes(output.blob.base64)
				if (bytesToBase64(bytes) !== output.blob.base64)
					throw new Error('non-canonical output blob')
				const claimId = crypto.randomUUID()
				const sha256 = await sha256Hex(bytes)
				await this.route.client.upload(
					this.route.scopeId,
					claimId,
					{ sha256, length: bytes.length, declaredMediaType: output.blob.mediaType },
					bytes
				)
				blob = { sha256, length: bytes.length }
				blobAuthorities[output.localKey] = { kind: 'upload-claim', claimId }
			}
			artifacts.push({
				localKey: output.localKey,
				typeKey: output.typeKey,
				typeVersion: output.typeVersion,
				payload: output.payload as ArtifactJson,
				blob,
				references: [],
				output: output.output
			})
		}
		const published = object(
			await this.route.client.publish(this.route.scopeId, run.publicationId, storeEpoch, {
				intent: {
					commandVersion: 1,
					publicationId: run.publicationId,
					scopeId: this.route.scopeId,
					kind: 'run',
					run: {
						procedureKey: run.procedureKey,
						procedureVersion: run.procedureVersion,
						initiator: { kind: 'user', id: `user:${this.route.userId}` },
						executor: { kind: 'agent', id: DOCUMENT_PROCEDURES[run.procedureKey]!.actor },
						inputs: run.inputs as unknown as ArtifactJson,
						parameters: run.parameters as ArtifactJson,
						implementation: {
							adapter: 'avenos-actor-runner',
							version: 'server-v1',
							deterministic: DOCUMENT_PROCEDURES[run.procedureKey]!.deterministic
						},
						receipt: DOCUMENT_PROCEDURES[run.procedureKey]!.deterministic
							? { outcome: 'succeeded' }
							: {
									outcome: 'succeeded',
									model: (run.parameters.modelReceipt ?? null) as ArtifactJson
								}
					},
					artifacts,
					evidence: run.evidence as unknown as ArtifactJson
				},
				blobAuthorities
			}),
			'Artifact Store publication'
		)
		if (!Array.isArray(published.artifacts)) throw new Error('Artifact Store omitted outputs')
		return {
			publicationId: string(published.publicationId, 'publication ID'),
			runId: string(published.runId, 'production run ID'),
			replayed: published.replayed === true,
			artifacts: published.artifacts.map((value) => {
				const artifact = object(value, 'published artifact')
				return {
					localKey: string(artifact.localKey, 'published artifact local key'),
					artifactId: string(artifact.artifactId, 'published artifact ID')
				}
			})
		}
	}
}

/** Scope-bound remote entry point; selection and matching are the shared portable skill. */
export function createReconciliationSkillExecutor(
	dependencies: Pick<DocumentSkillExecutorDependencies, 'artifactsFor'>
): PlanRunExecutor {
	return async (request) => {
		if (
			request.protocol !== ACTOR_RUN_PROTOCOL ||
			request.skillRef !== RECONCILIATION_SKILL ||
			request.executionEnvironment !== 'server' ||
			request.ingredients.length !== 0 ||
			request.goals.length !== 1 ||
			request.goals[0] !== RECONCILIATION_GOAL
		)
			throw new Error('invalid reconciliation command')
		if (Object.keys(request.parameters).some((key) => key !== 'openItemArtifactId'))
			throw new Error('unexpected reconciliation parameters')
		const openItemArtifactId = request.parameters.openItemArtifactId
		if (
			openItemArtifactId !== undefined &&
			(typeof openItemArtifactId !== 'string' || !/^[0-9a-f-]{36}$/i.test(openItemArtifactId))
		)
			throw new Error('invalid reconciliation open item')
		const route = await dependencies.artifactsFor(request)
		if (!route.scopeId || route.scopeId !== request.security.access.tenantId)
			throw new Error('reconciliation route differs from admitted tenant')
		const result = await reconcileInvoices(new ArtifactStoreDocumentGateway(route), {
			procedureVersion: 'server-v1',
			...(typeof openItemArtifactId === 'string' && { openItemArtifactId })
		})
		return {
			artifactIds: result.reviews.map((review) => review.candidateArtifactId),
			completedStepIds: ['reconciliation.review-ready'],
			remainingGoals: [],
			registryRevision: 0,
			policyDecisionIds: ['reconciliation:tenant-bound-read-and-propose'],
			output: { kind: 'reconciliation-review', result: portableRunClone(result) }
		}
	}
}

/** Headless deterministic decoder used by the server lane. */
export class ServerDocumentDecoder implements DocumentDecoder {
	#base64?: string
	#bytes?: Uint8Array
	private bytes(source: DocumentSource): Uint8Array {
		if (this.#base64 !== source.base64) {
			this.#bytes = base64ToBytes(source.base64)
			this.#base64 = source.base64
		}
		return this.#bytes!
	}
	async decode(
		source: DocumentSource,
		options: DocumentDecodeOptions = { modelPageLimit: 0 }
	): Promise<DecodedDocument> {
		const bytes = this.bytes(source)
		if (bytes.byteLength > MAX_FILE_BYTES)
			throw new Error('file exceeds the 128 MiB processing limit')
		if (isPdf(bytes)) return decodePdf(bytes, options)
		const png = pngDimensions(bytes)
		if (png && boundedImage(...png)) return imageDocument(source, 'image/png', png, options)
		const jpeg = jpegDimensions(bytes)
		const visual = jpeg ? jpegVisualBytes(bytes) : null
		if (jpeg && visual && boundedImage(...jpeg)) {
			return imageDocument(
				{ ...source, base64: bytesToBase64(visual) },
				'image/jpeg',
				jpeg,
				options
			)
		}
		const plain = decodePlainText(source, bytes, options)
		if (plain) return plain
		return {
			outcome: 'unsupported',
			detectedMediaType: 'application/octet-stream',
			encrypted: false,
			pages: []
		}
	}
}

async function decodePdf(
	bytes: Uint8Array,
	options: DocumentDecodeOptions
): Promise<DecodedDocument> {
	const task = pdfjs.getDocument({ data: bytes.slice(), CanvasFactory: ServerPdfCanvasFactory })
	try {
		const pdf = await task.promise
		if (pdf.numPages > MAX_DOCUMENT_PAGES) return unsupportedPdf()
		const pages: DecodedPage[] = []
		if (options.metadataOnly) {
			const metadata: DecodedPage[] = []
			for (let number = 1; number <= pdf.numPages; number++) {
				const page = await pdf.getPage(number)
				const viewport = page.getViewport({ scale: 1 })
				metadata.push({
					page: number,
					rotation: normalizeRotation(page.rotate),
					width: viewport.width,
					height: viewport.height,
					runs: [],
					deferred: true
				})
				page.cleanup()
			}
			return {
				outcome: 'ok',
				detectedMediaType: 'application/pdf',
				encrypted: false,
				pages: metadata
			}
		}
		const start = options.pageRange?.start ?? 1
		const end = Math.min(pdf.numPages, start + (options.pageRange?.count ?? pdf.numPages) - 1)
		const renderForModel =
			!options.metadataOnly &&
			options.modelPageLimit > 0 &&
			end - start + 1 <= options.modelPageLimit
		for (let number = start; number <= end; number += 1) {
			const page = await pdf.getPage(number)
			const viewport = page.getViewport({ scale: 1 })
			const content = await readPdfTextContent(page)
			const runs = content.items.flatMap((item) => {
				const run = normalizedRun(item, viewport)
				return run ? [run] : []
			})
			let image: DecodedPage['image']
			if (renderForModel) {
				const renderViewport = page.getViewport({
					scale: renderScale(viewport.width, viewport.height, pdf.numPages)
				})
				const width = Math.ceil(renderViewport.width)
				const height = Math.ceil(renderViewport.height)
				if (!boundedImage(width, height))
					throw new Error('rendered model page exceeds 40 million pixels')
				const canvas = createCanvas(width, height)
				const context = canvas.getContext('2d')
				await page.render({
					canvas: canvas as never,
					canvasContext: context as never,
					viewport: renderViewport
				}).promise
				image = {
					mediaType: 'image/png',
					base64: boundedBase64(canvas.toBuffer('image/png').toString('base64'))
				}
			}
			pages.push({
				page: number,
				rotation: normalizeRotation(page.rotate),
				width: viewport.width,
				height: viewport.height,
				runs,
				...(image && { image })
			})
		}
		return pages.length
			? { outcome: 'ok', detectedMediaType: 'application/pdf', encrypted: false, pages }
			: malformed('application/pdf')
	} catch (error) {
		const kind = pdfDecodeFailureKind(error)
		if (kind === 'encrypted') {
			return {
				outcome: 'encrypted',
				detectedMediaType: 'application/pdf',
				encrypted: true,
				pages: []
			}
		}
		if (kind === 'malformed') return malformed('application/pdf')
		console.warn(`PDF decoding failed because of a ${kind} decoder failure.`)
		throw new Error('PDF processing failed before its content could be inspected.', {
			cause: error
		})
	} finally {
		await task.destroy().catch(() => undefined)
	}
}

function imageDocument(
	source: DocumentSource,
	mediaType: 'image/png' | 'image/jpeg',
	dimensions: [number, number],
	options: DocumentDecodeOptions
): DecodedDocument {
	return {
		outcome: 'ok',
		detectedMediaType: mediaType,
		encrypted: false,
		pages: [
			{
				page: 1,
				rotation: 0,
				width: dimensions[0],
				height: dimensions[1],
				runs: [],
				...(options.metadataOnly && { deferred: true }),
				...(!options.metadataOnly &&
					options.modelPageLimit > 0 &&
					base64Length(source.base64) <= MAX_RENDER_BYTES && {
						image: { mediaType, base64: boundedBase64(source.base64) }
					})
			}
		]
	}
}

function malformed(mediaType: string): DecodedDocument {
	return { outcome: 'malformed', detectedMediaType: mediaType, encrypted: false, pages: [] }
}

function unsupportedPdf(): DecodedDocument {
	return {
		outcome: 'unsupported',
		detectedMediaType: 'application/pdf',
		encrypted: false,
		pages: []
	}
}

function object(value: unknown, label: string): Record<string, unknown> {
	const result = objectOrNull(value)
	if (!result) throw new Error(`${label} must be an object`)
	return result
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function string(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a string`)
	return value
}

export type { ArtifactProcessingPresentation }

function base64ToBytes(encoded: string): Uint8Array {
	const raw = atob(encoded)
	const bytes = new Uint8Array(raw.length)
	for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
	return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))
	return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
