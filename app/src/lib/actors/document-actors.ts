import { Actor, type Manifest } from './actor'
import {
	type DocumentModelGateway,
	type DocumentModelImage,
	type DocumentModelReceipt,
	modelRequest
} from './document-model'

export const MAX_DOCUMENT_PAGES = 63
const MAX_TEXT_BYTES = 2_000_000
const MAX_LAYOUT_SPANS = 512

export interface DocumentSource {
	artifactId: string
	originalName: string
	declaredMediaType: string
	base64: string
}

export interface DecodedTextRun {
	text: string
	x: number
	y: number
	width: number
	height: number
}

export interface DecodedPage {
	page: number
	rotation: 0 | 90 | 180 | 270
	width: number
	height: number
	runs: DecodedTextRun[]
	image?: { mediaType: 'image/png' | 'image/jpeg'; base64: string }
}

export interface DecodedDocument {
	outcome: 'ok' | 'malformed' | 'encrypted' | 'unsupported'
	detectedMediaType: string
	encrypted: boolean
	pages: DecodedPage[]
}

export interface DocumentDecoder {
	decode(source: DocumentSource, options?: { modelPageLimit: number }): Promise<DecodedDocument>
}

export interface ClientArtifactDraft {
	localKey: string
	typeKey: string
	typeVersion: 1
	payload: Record<string, unknown>
	output: { role: string; ordinal: number }
	blob?: { mediaType: string; base64: string }
}

export type ClientLocator =
	| { kind: 'artifact-root' }
	| { kind: 'json-pointer'; pointer: string }
	| { kind: 'byte-range'; start: number; endExclusive: number }
	| { kind: 'page-region'; page: number; x: number; y: number; width: number; height: number }

export interface ClientEvidence {
	ordinal: number
	outputLocalKey: string
	outputLocator: ClientLocator
	inputRole: string
	inputOrdinal: number
	inputLocator: ClientLocator
}

export interface DocumentActorResult {
	ok: true
	procedureKey: string
	artifacts: ClientArtifactDraft[]
	evidence: ClientEvidence[]
	document?: DecodedDocument
	modelReceipt?: DocumentModelReceipt
}

export interface ExtractedPage {
	page: number
	text: string
	method: 'native' | 'ocr'
	spans: Array<{
		start: number
		endExclusive: number
		page: number
		x: number
		y: number
		width: number
		height: number
	}>
	complete: boolean
}

export interface PageClassification {
	page: number
	primaryKind: string
	facets: string[]
	complete: boolean
}

const wholeArtifact = (): ClientLocator => ({ kind: 'artifact-root' })
const wholePage = (page: number): ClientLocator => ({
	kind: 'page-region',
	page,
	x: 0,
	y: 0,
	width: 1_000_000,
	height: 1_000_000
})

function artifact(
	localKey: string,
	typeKey: string,
	payload: Record<string, unknown>,
	role: string,
	ordinal = 0,
	blob?: { mediaType: string; base64: string }
): ClientArtifactDraft {
	return {
		localKey,
		typeKey,
		typeVersion: 1,
		payload,
		output: { role, ordinal },
		...(blob && { blob })
	}
}

function success(result: DocumentActorResult, wire: string) {
	return { record: JSON.stringify(result), wire }
}

function failure(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	return {
		record: JSON.stringify({ ok: false, error: message }),
		wire: message
	}
}

function manifest(
	id: string,
	name: string,
	description: string,
	method: string,
	requires: string[],
	produces: string[]
): Manifest {
	return {
		id,
		name,
		description,
		tags: ['docs', 'client-processing'],
		methods: [
			{
				name: method,
				description,
				parameters: { type: 'object', additionalProperties: true },
				requires,
				produces
			}
		]
	}
}

function normalizedDimensions(
	width: number,
	height: number
): { widthUnits: number; heightUnits: number } {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
		throw new Error('page dimensions are invalid')
	}
	if (width >= height) {
		return {
			widthUnits: 1_000_000,
			heightUnits: Math.max(1, Math.round((height / width) * 1_000_000))
		}
	}
	return {
		widthUnits: Math.max(1, Math.round((width / height) * 1_000_000)),
		heightUnits: 1_000_000
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

function utf8Length(value: string): number {
	return new TextEncoder().encode(value).length
}

function materializePage(page: DecodedPage): ExtractedPage {
	let text = ''
	let complete = true
	const spans: ExtractedPage['spans'] = []
	for (const run of page.runs) {
		const value = run.text.trim()
		if (value === '') continue
		const separator = text === '' ? '' : ' '
		const start = utf8Length(text + separator)
		const candidate = text + separator + value
		if (utf8Length(candidate) > MAX_TEXT_BYTES) {
			complete = false
			break
		}
		text = candidate
		const endExclusive = utf8Length(text)
		if (spans.length < MAX_LAYOUT_SPANS) {
			spans.push({
				start,
				endExclusive,
				page: page.page,
				x: run.x,
				y: run.y,
				width: run.width,
				height: run.height
			})
		} else {
			complete = false
		}
	}
	return { page: page.page, text, method: 'native', spans, complete }
}

function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} is not an object`)
	}
	return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new Error(`${label} is not a string`)
	return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new Error(`${label} is outside its contract`)
	}
	return Number(value)
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${label} is not a boolean`)
	return value
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new Error(`${label} is not a string array`)
	}
	return value
}

function pageImage(page: DecodedPage): DocumentModelImage {
	if (!page.image) throw new Error(`rendered image for page ${page.page} is missing`)
	return { page: page.page, ...page.image }
}

function joinedText(pages: ExtractedPage[]): string {
	return pages.map((page) => page.text).join('\n\n')
}

function pointerExists(value: unknown, pointer: string): boolean {
	if (!pointer.startsWith('/')) return false
	let current = value
	for (const encoded of pointer.slice(1).split('/')) {
		const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~')
		if (Array.isArray(current)) {
			const index = Number(key)
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return false
			current = current[index]
		} else if (current && typeof current === 'object' && Object.hasOwn(current, key)) {
			current = (current as Record<string, unknown>)[key]
		} else return false
	}
	return current !== null && current !== undefined
}

function extractionEvidence(
	structured: Record<string, unknown>,
	targets: Record<string, { outputLocalKey: string; value: unknown }>
): ClientEvidence[] {
	if (!Array.isArray(structured.evidence)) return []
	const evidence: ClientEvidence[] = []
	for (const raw of structured.evidence) {
		if (evidence.length >= 256) break
		try {
			const item = object(raw, 'model evidence')
			const target = stringValue(item.target, 'model evidence target')
			const pointer = stringValue(item.pointer, 'model evidence pointer')
			const resolved = targets[target]
			if (!resolved || !pointerExists(resolved.value, pointer)) continue
			const page = integer(item.page, 'model evidence page', 1, MAX_DOCUMENT_PAGES)
			evidence.push({
				ordinal: evidence.length,
				outputLocalKey: resolved.outputLocalKey,
				outputLocator: { kind: 'json-pointer', pointer },
				inputRole: 'source',
				inputOrdinal: 0,
				inputLocator: {
					kind: 'page-region',
					page,
					x: integer(item.x, 'model evidence x', 0, 1_000_000),
					y: integer(item.y, 'model evidence y', 0, 1_000_000),
					width: integer(item.width, 'model evidence width', 0, 1_000_000),
					height: integer(item.height, 'model evidence height', 0, 1_000_000)
				}
			})
		} catch {
			// Evidence is best effort. Invalid entries never survive into provenance.
		}
	}
	return evidence
}

export interface DocumentActors {
	inspect: Actor
	decompose: Actor
	extractText: Actor
	classifyPage: Actor
	assemble: Actor
	aggregate: Actor
	analyzePage?: Actor
	classifyDocument?: Actor
	extractInvoice?: Actor
	extractStatement?: Actor
	validateInvoice: Actor
	validateStatement: Actor
	all: Actor[]
}

/**
 * The deterministic document lane, ported from the server processor into
 * ordinary client actors. The decoder is injected so the browser uses pdf.js
 * while tests and future headless hosts can provide another implementation.
 */
export function createDocumentActors(
	decoder: DocumentDecoder,
	model?: DocumentModelGateway
): DocumentActors {
	const inspect = new Actor(
		manifest(
			'document-inspector',
			'Document inspector',
			'Inspects exact file bytes and identifies a readable paged document.',
			'document_inspect',
			['file(F)'],
			['file_inspection(F, I)']
		),
		{
			document_inspect: async (payload) => {
				try {
					const source = payload.source as unknown as DocumentSource
					const modelPageLimit = Number(payload.modelPageLimit ?? 0)
					const document = await decoder.decode(source, {
						modelPageLimit:
							Number.isInteger(modelPageLimit) && modelPageLimit >= 0
								? Math.min(modelPageLimit, MAX_DOCUMENT_PAGES)
								: 0
					})
					if (document.pages.length > MAX_DOCUMENT_PAGES) {
						throw new Error(
							`document has ${document.pages.length} pages; maximum is ${MAX_DOCUMENT_PAGES}`
						)
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.inspect-file',
							document,
							artifacts: [
								artifact(
									'inspection',
									'core.file-inspection',
									{
										outcome: document.outcome,
										detectedMediaType: document.detectedMediaType,
										readable: document.outcome === 'ok',
										pageCount: document.pages.length,
										encrypted: document.encrypted
									},
									'inspection'
								)
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'inspection',
									outputLocator: wholeArtifact(),
									inputRole: 'source',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								}
							]
						},
						`Inspected ${document.pages.length} page(s).`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const decompose = new Actor(
		manifest(
			'document-decomposer',
			'Document decomposer',
			'Turns a readable document into stable logical page artifacts.',
			'document_decompose',
			['file(F)', 'file_inspection(F, I)'],
			['page(F, P)']
		),
		{
			document_decompose: (payload) => {
				try {
					const document = payload.document as unknown as DecodedDocument
					if (document.outcome !== 'ok' || document.pages.length === 0) {
						throw new Error(`document cannot be decomposed: ${document.outcome}`)
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.decompose-pages',
							artifacts: document.pages.map((page, index) => {
								const dimensions = normalizedDimensions(page.width, page.height)
								return artifact(
									`page-${String(page.page).padStart(3, '0')}`,
									'docs.page',
									{
										sourcePage: page.page,
										rotationDegrees: page.rotation,
										...dimensions
									},
									'page',
									index
								)
							}),
							evidence: document.pages.map((page, index) => ({
								ordinal: index,
								outputLocalKey: `page-${String(page.page).padStart(3, '0')}`,
								outputLocator: wholeArtifact(),
								inputRole: 'source',
								inputOrdinal: 0,
								inputLocator: wholePage(page.page)
							}))
						},
						`Decomposed ${document.pages.length} page(s).`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const extractText = new Actor(
		manifest(
			'native-text-extractor',
			'Native text extractor',
			'Extracts embedded page text and a bounded normalized layout map.',
			'document_extract_native_text',
			['file(F)', 'page(F, P)'],
			['extracted_text(F, P, T)', 'text_layout(F, P, L)']
		),
		{
			document_extract_native_text: (payload) => {
				try {
					const page = payload.page as unknown as DecodedPage
					const extracted = materializePage(page)
					const bytes = new TextEncoder().encode(extracted.text)
					const evidence: ClientEvidence[] = [
						{
							ordinal: 0,
							outputLocalKey: 'layout',
							outputLocator: wholeArtifact(),
							inputRole: 'source',
							inputOrdinal: 0,
							inputLocator: wholePage(page.page)
						}
					]
					if (bytes.length > 0) {
						evidence.push({
							ordinal: 1,
							outputLocalKey: 'text',
							outputLocator: { kind: 'byte-range', start: 0, endExclusive: bytes.length },
							inputRole: 'source',
							inputOrdinal: 0,
							inputLocator: wholePage(page.page)
						})
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.extract-native-text',
							artifacts: [
								artifact(
									'text',
									'docs.extracted-text',
									{
										method: 'native',
										language: 'und',
										pageCount: 1,
										characterCount: [...extracted.text].length,
										complete: extracted.complete
									},
									'text',
									0,
									{ mediaType: 'text/plain; charset=utf-8', base64: bytesToBase64(bytes) }
								),
								artifact(
									'layout',
									'docs.text-layout',
									{
										coordinateSpace: 'normalized-millionths',
										spans: extracted.spans,
										complete: extracted.complete
									},
									'layout'
								)
							],
							evidence
						},
						`Extracted ${extracted.text.length} character(s) from page ${page.page}.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const classifyPage = new Actor(
		manifest(
			'page-signal-classifier',
			'Page signal classifier',
			'Classifies a page from deterministic media and native-text signals.',
			'document_classify_page',
			['file(F)', 'page(F, P)', 'extracted_text(F, P, T)'],
			['content_classification(P, C)']
		),
		{
			document_classify_page: (payload) => {
				try {
					const page = payload.page as unknown as DecodedPage
					const extracted = payload.extracted as unknown as ExtractedPage
					const mediaType = String(payload.mediaType ?? 'application/octet-stream')
					const hasText = /\S/u.test(extracted.text)
					const image = mediaType === 'image/png' || mediaType === 'image/jpeg'
					const primaryKind = hasText ? 'document' : image ? 'image' : 'unknown'
					const facets = hasText ? ['native-text'] : []
					const complete = primaryKind !== 'unknown'
					return success(
						{
							ok: true,
							procedureKey: 'client.classify-page-signals',
							artifacts: [
								artifact(
									'classification',
									'core.content-classification',
									{
										subjectLevel: 'page',
										primaryKind,
										facets,
										confidenceBps: complete ? 10_000 : 0,
										reason: hasText
											? 'The client native-text actor returned non-whitespace text.'
											: image
												? 'The source is a supported image; no semantic visual claim was made.'
												: 'No trustworthy native text was present; OCR is required.',
										resolutionMode: 'rule',
										complete
									},
									'classification'
								)
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'classification',
									outputLocator: wholeArtifact(),
									inputRole: 'source',
									inputOrdinal: 0,
									inputLocator: wholePage(page.page)
								}
							]
						},
						`Classified page ${page.page} as ${primaryKind}.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const assemble = new Actor(
		manifest(
			'document-assembler',
			'Document assembler',
			'Assembles page representations into one bounded document representation.',
			'document_assemble',
			['extracted_text(F, P, T)'],
			['document_text(F, T)', 'document_layout(F, L)']
		),
		{
			document_assemble: (payload) => {
				try {
					const pages = payload.pages as unknown as ExtractedPage[]
					const method = pages.some((page) => page.method === 'ocr') ? 'ocr' : 'native'
					let text = ''
					let complete = pages.every((page) => page.complete)
					const spans: ExtractedPage['spans'] = []
					for (const page of pages) {
						const separator = text === '' ? '' : '\n\n'
						const byteOffset = utf8Length(text + separator)
						if (byteOffset + utf8Length(page.text) > MAX_TEXT_BYTES) {
							complete = false
							break
						}
						text += separator + page.text
						for (const span of page.spans) {
							if (spans.length >= MAX_LAYOUT_SPANS) {
								complete = false
								break
							}
							spans.push({
								...span,
								start: byteOffset + span.start,
								endExclusive: byteOffset + span.endExclusive
							})
						}
					}
					const bytes = new TextEncoder().encode(text)
					return success(
						{
							ok: true,
							procedureKey: 'client.assemble-document-representation',
							artifacts: [
								artifact(
									'text',
									'docs.extracted-text',
									{
										method,
										language: 'und',
										pageCount: pages.length,
										characterCount: [...text].length,
										complete
									},
									'text',
									0,
									{ mediaType: 'text/plain; charset=utf-8', base64: bytesToBase64(bytes) }
								),
								artifact(
									'layout',
									'docs.text-layout',
									{ coordinateSpace: 'normalized-millionths', spans, complete },
									'layout'
								)
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'layout',
									outputLocator: wholeArtifact(),
									inputRole: 'source',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								}
							]
						},
						`Assembled ${pages.length} page representation(s).`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const aggregate = new Actor(
		manifest(
			'content-aggregator',
			'Content aggregator',
			'Combines every page classification without inventing missing knowledge.',
			'document_aggregate_content',
			['content_classification(P, C)', 'document_text(F, T)'],
			['content_classification(F, C)']
		),
		{
			document_aggregate_content: (payload) => {
				try {
					const pages = payload.pages as unknown as PageClassification[]
					const kinds = pages.map((page) => page.primaryKind)
					const primaryKind = kinds.includes('document')
						? 'document'
						: kinds.length > 0 && kinds.every((kind) => kind === 'image')
							? 'image'
							: 'unknown'
					const complete = pages.length > 0 && pages.every((page) => page.complete)
					const facets = [...new Set(pages.flatMap((page) => page.facets))].sort()
					return success(
						{
							ok: true,
							procedureKey: 'client.aggregate-content-classification',
							artifacts: [
								artifact(
									'classification',
									'core.content-classification',
									{
										subjectLevel: 'file',
										primaryKind,
										facets,
										confidenceBps: complete ? 10_000 : 0,
										reason: 'Deterministic client aggregation preserved every page outcome.',
										resolutionMode: 'rule',
										complete
									},
									'classification'
								)
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'classification',
									outputLocator: wholeArtifact(),
									inputRole: 'source',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								}
							]
						},
						`Aggregated ${pages.length} page classification(s).`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const analyzePage = model
		? new Actor(
				manifest(
					'visual-page-analyzer',
					'Visual page analyzer',
					'Transcribes, describes, and classifies one rendered page with the configured vision model.',
					'document_analyze_page',
					['file(F)', 'page(F, P)', 'extracted_text(F, P, T)'],
					[
						'extracted_text(F, P, T)',
						'text_layout(F, P, L)',
						'content_classification(P, C)',
						'content_description(P, D)'
					]
				),
				{
					document_analyze_page: async (payload) => {
						try {
							const page = payload.page as unknown as DecodedPage
							const native = payload.extracted as unknown as ExtractedPage
							const completed = await model.complete(
								modelRequest('analyze-page', [pageImage(page)], native.text)
							)
							const structured = completed.structured
							const suppliedText = stringValue(structured.text, 'OCR text')
							if (utf8Length(suppliedText) > 200_000) throw new Error('OCR text is too large')
							if (!Array.isArray(structured.blocks)) throw new Error('OCR blocks are absent')
							const blocks = structured.blocks.slice(0, MAX_LAYOUT_SPANS).map((raw) => {
								const block = object(raw, 'OCR block')
								return {
									text: stringValue(block.text, 'OCR block text'),
									x: integer(block.x, 'OCR block x', 0, 1_000_000),
									y: integer(block.y, 'OCR block y', 0, 1_000_000),
									width: integer(block.width, 'OCR block width', 0, 1_000_000),
									height: integer(block.height, 'OCR block height', 0, 1_000_000)
								}
							})
							let text = suppliedText
							let searchFrom = 0
							let ordered = true
							let spans: ExtractedPage['spans'] = []
							for (const block of blocks) {
								const relative = text.slice(searchFrom).indexOf(block.text)
								if (relative < 0) {
									ordered = false
									break
								}
								const characterStart = searchFrom + relative
								const characterEnd = characterStart + block.text.length
								spans.push({
									start: utf8Length(text.slice(0, characterStart)),
									endExclusive: utf8Length(text.slice(0, characterEnd)),
									page: page.page,
									x: block.x,
									y: block.y,
									width: block.width,
									height: block.height
								})
								searchFrom = characterEnd
							}
							if (!ordered) {
								text = blocks.map((block) => block.text).join('\n')
								spans = []
								let offset = 0
								for (const block of blocks) {
									const length = utf8Length(block.text)
									spans.push({
										start: offset,
										endExclusive: offset + length,
										page: page.page,
										x: block.x,
										y: block.y,
										width: block.width,
										height: block.height
									})
									offset += length + 1
								}
							}
							const complete = booleanValue(structured.complete, 'page completeness') && ordered
							const bytes = new TextEncoder().encode(text)
							const artifacts = [
								artifact(
									'text',
									'docs.extracted-text',
									{
										method: 'ocr',
										language: stringValue(structured.language, 'OCR language'),
										pageCount: 1,
										characterCount: [...text].length,
										complete
									},
									'text',
									0,
									{ mediaType: 'text/plain; charset=utf-8', base64: bytesToBase64(bytes) }
								),
								artifact(
									'layout',
									'docs.text-layout',
									{ coordinateSpace: 'normalized-millionths', spans, complete },
									'layout'
								),
								artifact(
									'classification',
									'core.content-classification',
									{
										subjectLevel: 'page',
										primaryKind: stringValue(structured.primaryKind, 'page kind'),
										facets: stringArray(structured.facets, 'page facets'),
										confidenceBps: integer(structured.confidenceBps, 'page confidence', 0, 10_000),
										reason: stringValue(structured.reason, 'page reason'),
										resolutionMode: 'model',
										complete: booleanValue(structured.complete, 'page completeness')
									},
									'classification'
								),
								artifact(
									'description',
									'core.content-description',
									{
										summary: stringValue(structured.summary, 'page summary'),
										topics: stringArray(structured.topics, 'page topics')
									},
									'description'
								)
							]
							return success(
								{
									ok: true,
									procedureKey: 'client.analyze-page-model',
									artifacts,
									evidence: artifacts.map((output, ordinal) => ({
										ordinal,
										outputLocalKey: output.localKey,
										outputLocator: wholeArtifact(),
										inputRole: 'source',
										inputOrdinal: 0,
										inputLocator: wholePage(page.page)
									})),
									modelReceipt: completed.receipt
								},
								`Visually analyzed page ${page.page}.`
							)
						} catch (error) {
							return failure(error)
						}
					}
				}
			)
		: undefined

	const classifyDocument = model
		? new Actor(
				manifest(
					'document-kind-classifier',
					'Document kind classifier',
					'Classifies the complete rendered document into the supported finance taxonomy.',
					'document_classify_kind',
					['file(F)', 'extracted_text(F, T)'],
					['document_classification(F, C)']
				),
				{
					document_classify_kind: async (payload) => {
						try {
							const document = payload.document as unknown as DecodedDocument
							const pages = payload.pages as unknown as ExtractedPage[]
							const completed = await model.complete(
								modelRequest('classify-document', document.pages.map(pageImage), joinedText(pages))
							)
							const structured = completed.structured
							const confidence = integer(structured.confidenceBps, 'document confidence', 0, 10_000)
							const rawKind = stringValue(
								structured.resolvedKind ?? structured.rawKind,
								'document kind'
							)
							const family = [
								'invoice',
								'credit-note',
								'receipt',
								'self-issued-receipt',
								'mandate',
								'order-confirmation',
								'offer',
								'reminder'
							].includes(rawKind)
								? 'invoice-family'
								: ['bank-statement', 'payment-receipt'].includes(rawKind)
									? 'statement-family'
									: 'unknown'
							const accepted = confidence >= 6500 && family !== 'unknown'
							const reason = stringValue(structured.reason, 'document classification reason')
							const classificationPayload = {
								rawKind,
								resolvedKind: accepted ? rawKind : 'unknown',
								family: accepted ? family : 'unknown',
								confidenceBps: confidence,
								reason: accepted
									? reason
									: `Not accepted as a supported kind at the 6500 basis-point threshold: ${reason}`,
								resolutionMode: 'model',
								alternatives: Array.isArray(structured.alternatives) ? structured.alternatives : []
							}
							return success(
								{
									ok: true,
									procedureKey: 'client.classify-document-model',
									artifacts: [
										artifact(
											'classification',
											'core.document-classification',
											classificationPayload,
											'classification'
										)
									],
									evidence: [
										{
											ordinal: 0,
											outputLocalKey: 'classification',
											outputLocator: wholeArtifact(),
											inputRole: 'source',
											inputOrdinal: 0,
											inputLocator: wholeArtifact()
										}
									],
									modelReceipt: completed.receipt
								},
								`Classified the document as ${classificationPayload.resolvedKind}.`
							)
						} catch (error) {
							return failure(error)
						}
					}
				}
			)
		: undefined

	const extractInvoice = model
		? new Actor(
				manifest(
					'invoice-extractor',
					'Invoice extractor',
					'Extracts a grounded compact invoice candidate and complete finance details.',
					'document_extract_invoice',
					['file(F)', 'document_classification(F, C)'],
					['invoice_candidate(F, I)', 'invoice_details(F, D)']
				),
				{
					document_extract_invoice: async (payload) => {
						try {
							const document = payload.document as unknown as DecodedDocument
							const pages = payload.pages as unknown as ExtractedPage[]
							const expectedKind = stringValue(payload.expectedKind, 'expected invoice kind')
							const completed = await model.complete(
								modelRequest(
									'extract-invoice',
									document.pages.map(pageImage),
									joinedText(pages),
									expectedKind
								)
							)
							const candidate = object(completed.structured.candidate, 'invoice candidate')
							const details = object(completed.structured.details, 'invoice details')
							if (details.documentKind !== expectedKind) {
								throw new Error(
									`invoice extraction kind ${String(details.documentKind)} conflicts with ${expectedKind}`
								)
							}
							const supplier = object(details.supplier, 'invoice supplier').name
							if (typeof supplier === 'string' && supplier.trim()) candidate.supplier = supplier
							return success(
								{
									ok: true,
									procedureKey: 'client.extract-invoice-model',
									artifacts: [
										artifact('invoice', 'bookkeeping.invoice-candidate', candidate, 'candidate'),
										artifact('details', 'bookkeeping.invoice-details', details, 'details')
									],
									evidence: extractionEvidence(completed.structured, {
										candidate: { outputLocalKey: 'invoice', value: candidate },
										details: { outputLocalKey: 'details', value: details }
									}),
									modelReceipt: completed.receipt
								},
								'Extracted the invoice candidate and details.'
							)
						} catch (error) {
							return failure(error)
						}
					}
				}
			)
		: undefined

	const extractStatement = model
		? new Actor(
				manifest(
					'statement-extractor',
					'Statement extractor',
					'Extracts a grounded account statement or payment receipt candidate.',
					'document_extract_statement',
					['file(F)', 'document_classification(F, C)'],
					['statement_candidate(F, S)']
				),
				{
					document_extract_statement: async (payload) => {
						try {
							const document = payload.document as unknown as DecodedDocument
							const pages = payload.pages as unknown as ExtractedPage[]
							const expectedKind = stringValue(payload.expectedKind, 'expected statement kind')
							const completed = await model.complete(
								modelRequest(
									'extract-statement',
									document.pages.map(pageImage),
									joinedText(pages),
									expectedKind
								)
							)
							const candidate = object(completed.structured.candidate, 'statement candidate')
							const extractedKind = String(candidate.statementKind)
							if (
								(expectedKind === 'payment-receipt' && extractedKind !== 'payment-receipt') ||
								(expectedKind === 'bank-statement' && extractedKind === 'payment-receipt')
							) {
								throw new Error(
									`statement extraction kind ${extractedKind} conflicts with ${expectedKind}`
								)
							}
							return success(
								{
									ok: true,
									procedureKey: 'client.extract-statement-model',
									artifacts: [
										artifact(
											'statement',
											'banking.account-statement-candidate',
											candidate,
											'candidate'
										)
									],
									evidence: extractionEvidence(completed.structured, {
										candidate: { outputLocalKey: 'statement', value: candidate }
									}),
									modelReceipt: completed.receipt
								},
								'Extracted the statement candidate.'
							)
						} catch (error) {
							return failure(error)
						}
					}
				}
			)
		: undefined

	const validateInvoice = new Actor(
		manifest(
			'invoice-validator',
			'Invoice validator',
			'Runs the invoice-core-v1 arithmetic and identity checks.',
			'document_validate_invoice',
			['invoice_candidate(F, I)'],
			['invoice_validation(I, V)']
		),
		{
			document_validate_invoice: (payload) => {
				try {
					const candidate = object(payload.candidate, 'invoice candidate')
					const net = candidate.netMinor
					const tax = candidate.taxMinor
					const gross = candidate.grossMinor
					const arithmetic =
						typeof net === 'number' &&
						typeof tax === 'number' &&
						typeof gross === 'number' &&
						Math.abs(net + tax - gross) <= 2
							? 'PASS'
							: 'UNKNOWN'
					const identity =
						typeof candidate.supplier === 'string' &&
						candidate.supplier.trim() !== '' &&
						typeof candidate.invoiceNumber === 'string' &&
						candidate.invoiceNumber.trim() !== ''
							? 'PASS'
							: 'FAIL'
					const outcomes = [arithmetic, identity]
					const status = outcomes.includes('FAIL')
						? 'inconsistent'
						: outcomes.includes('UNKNOWN')
							? 'insufficient-coverage'
							: 'consistent'
					const validation = {
						rulesetVersion: 'invoice-core-v1',
						status,
						coverageBps: outcomes.filter((outcome) => outcome !== 'UNKNOWN').length * 5000,
						checks: [
							{
								ruleId: 'invoice.net-plus-tax-equals-gross',
								outcome: arithmetic,
								severity: 'hard',
								paths: ['/netMinor', '/taxMinor', '/grossMinor'],
								message: 'Net plus tax agrees with gross, or requires explicit adjustment coverage.'
							},
							{
								ruleId: 'invoice.identity-present',
								outcome: identity,
								severity: 'hard',
								paths: ['/supplier', '/invoiceNumber'],
								message: 'Supplier and invoice number must both be present.'
							}
						]
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.validate-invoice',
							artifacts: [
								artifact('validation', 'bookkeeping.invoice-validation', validation, 'validation')
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'validation',
									outputLocator: wholeArtifact(),
									inputRole: 'candidate',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								}
							]
						},
						`Invoice validation is ${status}.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const validateStatement = new Actor(
		manifest(
			'statement-validator',
			'Statement validator',
			'Runs the statement-core-v1 balance, period, and payment-receipt checks.',
			'document_validate_statement',
			['statement_candidate(F, S)'],
			['statement_validation(S, V)']
		),
		{
			document_validate_statement: (payload) => {
				try {
					const candidate = object(payload.candidate, 'statement candidate')
					if (!Array.isArray(candidate.transactions)) {
						throw new Error('statement transactions are invalid')
					}
					const transactions = candidate.transactions.map((item) =>
						object(item, 'statement transaction')
					)
					const amounts = transactions.map((transaction) => transaction.amountMinor)
					const allAmounts = amounts.every((amount) => typeof amount === 'number')
					const balance =
						typeof candidate.openingBalanceMinor === 'number' &&
						typeof candidate.closingBalanceMinor === 'number' &&
						allAmounts
							? candidate.openingBalanceMinor +
									amounts.reduce<number>((sum, amount) => sum + Number(amount), 0) ===
								candidate.closingBalanceMinor
								? 'PASS'
								: 'FAIL'
							: 'UNKNOWN'
					const period =
						typeof candidate.periodStart === 'string' && typeof candidate.periodEnd === 'string'
							? candidate.periodStart <= candidate.periodEnd
								? 'PASS'
								: 'FAIL'
							: 'UNKNOWN'
					const receipt =
						candidate.statementKind === 'payment-receipt'
							? transactions.length === 1 &&
								typeof transactions[0]?.amountMinor === 'number' &&
								transactions[0].amountMinor < 0
								? 'PASS'
								: 'FAIL'
							: 'UNKNOWN'
					const outcomes = [balance, period, receipt]
					const status = outcomes.includes('FAIL')
						? 'inconsistent'
						: outcomes.every((outcome) => outcome === 'UNKNOWN')
							? 'incomplete'
							: 'consistent'
					const validation = {
						rulesetVersion: 'statement-core-v1',
						status,
						coverageBps: Math.floor(
							(outcomes.filter((outcome) => outcome !== 'UNKNOWN').length * 10_000) /
								outcomes.length
						),
						checks: [
							{
								ruleId: 'statement.opening-plus-transactions-equals-closing',
								outcome: balance,
								severity: 'hard',
								paths: ['/openingBalanceMinor', '/transactions', '/closingBalanceMinor'],
								message:
									'Opening balance plus transaction amounts should equal closing balance when all operands are printed.'
							},
							{
								ruleId: 'statement.period-ordered',
								outcome: period,
								severity: 'hard',
								paths: ['/periodStart', '/periodEnd'],
								message: 'Statement period start must not be after period end.'
							},
							{
								ruleId: 'statement.payment-receipt-shape',
								outcome: receipt,
								severity: 'soft',
								paths: ['/statementKind', '/transactions'],
								message: 'A payment receipt should contain exactly one outgoing transaction.'
							}
						]
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.validate-statement',
							artifacts: [
								artifact('validation', 'banking.statement-validation', validation, 'validation')
							],
							evidence: [
								{
									ordinal: 0,
									outputLocalKey: 'validation',
									outputLocator: wholeArtifact(),
									inputRole: 'candidate',
									inputOrdinal: 0,
									inputLocator: wholeArtifact()
								}
							]
						},
						`Statement validation is ${status}.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)

	const optionalModelActors = [
		analyzePage,
		classifyDocument,
		extractInvoice,
		extractStatement
	].filter((actor): actor is Actor => Boolean(actor))
	return {
		inspect,
		decompose,
		extractText,
		classifyPage,
		assemble,
		aggregate,
		analyzePage,
		classifyDocument,
		extractInvoice,
		extractStatement,
		validateInvoice,
		validateStatement,
		all: [
			inspect,
			decompose,
			extractText,
			classifyPage,
			assemble,
			aggregate,
			...optionalModelActors,
			validateInvoice,
			validateStatement
		]
	}
}

export function parseDocumentActorResult(record: string): DocumentActorResult {
	const parsed = JSON.parse(record) as DocumentActorResult | { ok: false; error: string }
	if (!parsed.ok) throw new Error(parsed.error)
	return parsed
}

export function extractedPageFrom(result: DocumentActorResult, page: number): ExtractedPage {
	const textArtifact = result.artifacts.find(
		(artifact) => artifact.typeKey === 'docs.extracted-text'
	)
	const layoutArtifact = result.artifacts.find(
		(artifact) => artifact.typeKey === 'docs.text-layout'
	)
	if (!textArtifact?.blob || !layoutArtifact)
		throw new Error('native text actor omitted its outputs')
	const binary = atob(textArtifact.blob.base64)
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
	return {
		page,
		text: new TextDecoder().decode(bytes),
		method: textArtifact.payload.method === 'ocr' ? 'ocr' : 'native',
		spans: layoutArtifact.payload.spans as ExtractedPage['spans'],
		complete: Boolean(textArtifact.payload.complete)
	}
}

export function pageClassificationFrom(
	result: DocumentActorResult,
	page: number
): PageClassification {
	const output = result.artifacts.find(
		(artifact) => artifact.typeKey === 'core.content-classification'
	)
	if (!output) throw new Error('page classifier omitted its output')
	return {
		page,
		primaryKind: String(output.payload.primaryKind),
		facets: output.payload.facets as string[],
		complete: Boolean(output.payload.complete)
	}
}
