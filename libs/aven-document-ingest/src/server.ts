import type { PlanRunExecutor, PlanRunStartRequest } from '@avenos/actors'
import { ACTOR_RUN_PROTOCOL, portableRunClone } from '@avenos/actors'
import type {
	ArtifactJson,
	ArtifactProcessingPresentation,
	ArtifactStoreClient,
	ClientArtifactGateway,
	ClientRunPublication,
	PublishedClientRun
} from '@avenos/artifact-store'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createDocumentActors } from './actors/registry'
import { DOCUMENT_INGEST_SKILL, type DocumentSourceDescriptor } from './execution'
import { DocumentProcessingRuntime } from './runtime'
import {
	type DecodedDocument,
	type DecodedPage,
	type DecodedTextRun,
	type DocumentDecoder,
	type DocumentSource,
	MAX_DOCUMENT_PAGES
} from './shared'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MILLION = 1_000_000

/** Artifact Store route selected from an already verified customer grant. */
export interface DocumentArtifactStoreRoute {
	client: ArtifactStoreClient
	scopeId: string
	userId: string
}

export interface DocumentSkillExecutorDependencies {
	artifactsFor(
		request: PlanRunStartRequest
	): DocumentArtifactStoreRoute | Promise<DocumentArtifactStoreRoute>
	decoder?: DocumentDecoder
}

/** Production executor for the application-owned document-ingest skill. */
export function createDocumentSkillExecutor(
	dependencies: DocumentSkillExecutorDependencies
): PlanRunExecutor {
	return async (request) => {
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
			throw new Error('file exceeds the 25 MiB processing limit')
		const source: DocumentSource = {
			artifactId: descriptor.artifactId,
			originalName,
			declaredMediaType,
			base64: bytesToBase64(bytes)
		}
		const gateway = new ArtifactStoreDocumentGateway(route)
		const runtime = new DocumentProcessingRuntime(
			createDocumentActors(dependencies.decoder ?? new ServerDocumentDecoder()),
			gateway,
			undefined,
			{
				executionEnvironment: 'server',
				runtimeHost: 'actor-runner',
				procedureVersion: 'server-v1'
			}
		)
		const presentation = await runtime.start(source)
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
			output: { presentation: portableRunClone(presentation) }
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
	if (request.goals.length !== 1 || request.goals[0] !== 'ceo.aven.docs.processed(source)') {
		throw new Error('document command has an invalid goal')
	}
}

function sourceDescriptor(value: unknown): DocumentSourceDescriptor {
	const source = object(value, 'document source')
	const artifactId = string(source.artifactId, 'document source artifact ID')
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			artifactId
		)
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
export class ArtifactStoreDocumentGateway implements ClientArtifactGateway {
	constructor(private readonly route: DocumentArtifactStoreRoute) {}

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
						executor: { kind: 'agent', id: `actor-runner:${run.procedureKey}` },
						inputs: run.inputs as unknown as ArtifactJson,
						parameters: run.parameters as ArtifactJson,
						implementation: {
							adapter: 'avenos-actor-runner',
							version: 'server-v1',
							deterministic: !run.procedureKey.endsWith('-model')
						},
						receipt: { outcome: 'succeeded' }
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

/** Headless deterministic decoder used by the server lane. */
export class ServerDocumentDecoder implements DocumentDecoder {
	async decode(
		source: DocumentSource,
		_options: { modelPageLimit: number } = { modelPageLimit: 0 }
	): Promise<DecodedDocument> {
		const bytes = base64ToBytes(source.base64)
		if (bytes.byteLength > MAX_FILE_BYTES)
			throw new Error('file exceeds the 25 MiB processing limit')
		const plain = decodePlainText(source, bytes)
		if (plain) return plain
		if (hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return decodePdf(bytes)
		return {
			outcome: 'unsupported',
			detectedMediaType: 'application/octet-stream',
			encrypted: false,
			pages: []
		}
	}
}

function decodePlainText(source: DocumentSource, bytes: Uint8Array): DecodedDocument | null {
	const textLike =
		source.declaredMediaType.toLowerCase().split(';', 1)[0]?.startsWith('text/') ||
		/\.(?:txt|md|csv)$/i.test(source.originalName)
	if (!textLike) return null
	let text: string
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
	} catch {
		return malformed('text/plain')
	}
	if (text.includes('\0')) return malformed('text/plain')
	return {
		outcome: 'ok',
		detectedMediaType: 'text/plain',
		encrypted: false,
		pages: [
			{
				page: 1,
				rotation: 0,
				width: 1,
				height: 1,
				runs: [{ text, x: 0, y: 0, width: MILLION, height: MILLION }]
			}
		]
	}
}

async function decodePdf(bytes: Uint8Array): Promise<DecodedDocument> {
	const task = pdfjs.getDocument({ data: bytes.slice() })
	try {
		const pdf = await task.promise
		if (pdf.numPages > MAX_DOCUMENT_PAGES) return unsupportedPdf()
		const pages: DecodedPage[] = []
		for (let number = 1; number <= pdf.numPages; number += 1) {
			const page = await pdf.getPage(number)
			const viewport = page.getViewport({ scale: 1 })
			const content = await page.getTextContent()
			const runs = content.items.flatMap((item) => {
				const run = normalizedRun(item, viewport.width, viewport.height)
				return run ? [run] : []
			})
			pages.push({
				page: number,
				rotation: normalizeRotation(page.rotate),
				width: viewport.width,
				height: viewport.height,
				runs
			})
		}
		return pages.length
			? { outcome: 'ok', detectedMediaType: 'application/pdf', encrypted: false, pages }
			: malformed('application/pdf')
	} catch (error) {
		return error instanceof Error && error.name === 'PasswordException'
			? { outcome: 'encrypted', detectedMediaType: 'application/pdf', encrypted: true, pages: [] }
			: malformed('application/pdf')
	} finally {
		await task.destroy().catch(() => undefined)
	}
}

function normalizedRun(
	item: unknown,
	pageWidth: number,
	pageHeight: number
): DecodedTextRun | null {
	const value = objectOrNull(item)
	if (!value || typeof value.str !== 'string' || !Array.isArray(value.transform)) return null
	const x = Number(value.transform[4] ?? 0)
	const baseline = Number(value.transform[5] ?? 0)
	const width = Number(value.width ?? 0)
	const height = Math.abs(Number(value.height ?? value.transform[3] ?? 0))
	return {
		text: value.str,
		x: normalized(x, pageWidth),
		y: normalized(Math.max(0, pageHeight - baseline - height), pageHeight),
		width: normalized(Math.max(0, width), pageWidth),
		height: normalized(Math.max(0, height), pageHeight)
	}
}

function normalized(value: number, extent: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) return 0
	return Math.max(0, Math.min(MILLION, Math.round((value / extent) * MILLION)))
}

function normalizeRotation(value: number): DecodedPage['rotation'] {
	const normalized = ((Math.round(value) % 360) + 360) % 360
	return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
	return prefix.every((byte, index) => bytes[index] === byte)
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
