import {
	type CapabilitySlot,
	functor,
	type Manifest,
	resourceId,
	type SchemaId
} from '@avenos/actors'
import type { ArtifactLocator, ClientArtifactDraft, ClientEvidence } from '@avenos/artifact-store'
import type { DocumentModelImage, DocumentModelReceipt } from './model'

export const MAX_DOCUMENT_PAGES = 63
export const MAX_TEXT_BYTES = 2_000_000
// The generic gateway counts instructions and the procedure prompt against its
// 2 MiB aggregate text limit. Keep room for those trusted fields.
export const MAX_MODEL_DOCUMENT_TEXT_BYTES = 1_950_000
export const MAX_LAYOUT_SPANS = 512

export interface DocumentSchemaBinding {
	schema: SchemaId
	typeKey: string
	typeVersion: 1
	role: string
}

export const DOCUMENT_SCHEMA_BINDINGS: Readonly<Record<string, DocumentSchemaBinding>> = {
	'ceo.aven.docs.file': binding('docs', 'file', 'core.file', 'source'),
	'ceo.aven.docs.file_inspection': binding(
		'docs',
		'file-inspection',
		'core.file-inspection',
		'inspection'
	),
	'ceo.aven.docs.page': binding('docs', 'page', 'docs.page', 'page'),
	'ceo.aven.docs.extracted_text': binding('docs', 'extracted-text', 'docs.extracted-text', 'text'),
	'ceo.aven.docs.text_layout': binding('docs', 'text-layout', 'docs.text-layout', 'layout'),
	'ceo.aven.docs.content_classification': binding(
		'docs',
		'content-classification',
		'core.content-classification',
		'classification'
	),
	'ceo.aven.docs.content_description': binding(
		'docs',
		'content-description',
		'core.content-description',
		'description'
	),
	'ceo.aven.docs.document_text': binding('docs', 'document-text', 'docs.extracted-text', 'text'),
	'ceo.aven.docs.document_layout': binding('docs', 'document-layout', 'docs.text-layout', 'layout'),
	'ceo.aven.docs.document_classification': binding(
		'docs',
		'document-classification',
		'core.document-classification',
		'classification'
	),
	'ceo.aven.bookkeeping.invoice_candidate': binding(
		'bookkeeping',
		'invoice-candidate',
		'bookkeeping.invoice-candidate',
		'candidate'
	),
	'ceo.aven.bookkeeping.invoice_details': binding(
		'bookkeeping',
		'invoice-details',
		'bookkeeping.invoice-details',
		'details'
	),
	'ceo.aven.bookkeeping.invoice_validation': binding(
		'bookkeeping',
		'invoice-validation',
		'bookkeeping.invoice-validation',
		'validation'
	),
	'ceo.aven.bookkeeping.statement_candidate': binding(
		'bookkeeping',
		'statement-candidate',
		'banking.account-statement-candidate',
		'candidate'
	),
	'ceo.aven.bookkeeping.statement_validation': binding(
		'bookkeeping',
		'statement-validation',
		'banking.statement-validation',
		'validation'
	)
}

function binding(namespace: string, name: string, typeKey: string, role: string) {
	return {
		schema: resourceId({
			authority: 'ceo.aven',
			kind: 'schema',
			namespace,
			name,
			version: '1'
		}),
		typeKey,
		typeVersion: 1 as const,
		role
	}
}

/** Current domain adapter from concrete store type to an input slot role. */
export function documentArtifactInputRole(
	typeKey: string,
	payload: Record<string, unknown>
): string {
	if (typeKey === 'core.content-classification') {
		return payload.subjectLevel === 'page' ? 'page-classification' : 'content-classification'
	}
	if (typeKey === 'core.document-classification') return 'document-classification'
	const binding = Object.values(DOCUMENT_SCHEMA_BINDINGS).find(
		(candidate) => candidate.typeKey === typeKey
	)
	return binding?.role ?? 'input'
}

function slot(predicate: string, method: string, direction: 'input' | 'output'): CapabilitySlot {
	const predicateFunctor = functor(predicate)
	const declared = DOCUMENT_SCHEMA_BINDINGS[predicateFunctor]
	if (!declared) throw new Error(`document predicate ${predicateFunctor} has no schema binding`)
	const role =
		method === 'document_aggregate_content' &&
		direction === 'input' &&
		predicateFunctor.endsWith('.content_classification')
			? 'page-classification'
			: direction === 'input' && predicateFunctor.endsWith('.document_classification')
				? 'document-classification'
				: declared.role
	const cardinality =
		(method === 'document_decompose' &&
			direction === 'output' &&
			predicateFunctor.endsWith('.page')) ||
		(method === 'document_assemble' &&
			direction === 'input' &&
			predicateFunctor.endsWith('.extracted_text')) ||
		(method === 'document_aggregate_content' &&
			direction === 'input' &&
			predicateFunctor.endsWith('.content_classification'))
			? 'many'
			: 'one'
	return {
		name: role,
		predicate,
		schema: declared.schema,
		role,
		cardinality
	}
}

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

export type { ClientArtifactDraft, ClientEvidence } from '@avenos/artifact-store'
export type ClientLocator = ArtifactLocator

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

export const wholeArtifact = (): ClientLocator => ({ kind: 'artifact-root' })
export const wholePage = (page: number): ClientLocator => ({
	kind: 'page-region',
	page,
	x: 0,
	y: 0,
	width: 1_000_000,
	height: 1_000_000
})

export function artifact(
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

export function success(result: DocumentActorResult, wire: string) {
	return { record: JSON.stringify(result), wire }
}

export function failure(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	return {
		record: JSON.stringify({ ok: false, error: message }),
		wire: message
	}
}

export function manifest(
	id: string,
	name: string,
	description: string,
	method: string,
	requires: string[],
	produces: string[]
): Manifest {
	return {
		id,
		authority: 'ceo.aven',
		namespace: 'docs.ingest',
		version: '1',
		name,
		description,
		tags: ['docs', 'client-processing'],
		methods: [
			{
				name: method,
				description,
				parameters: { type: 'object', additionalProperties: true },
				requires,
				produces,
				inputSlots: requires.map((predicate) => slot(predicate, method, 'input')),
				outputSlots: produces.map((predicate) => slot(predicate, method, 'output'))
			}
		]
	}
}

export function normalizedDimensions(
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

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	}
	return btoa(binary)
}

export function utf8Length(value: string): number {
	return new TextEncoder().encode(value).length
}

export function materializePage(page: DecodedPage): ExtractedPage {
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

export function object(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} is not an object`)
	}
	return value as Record<string, unknown>
}

export function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new Error(`${label} is not a string`)
	return value
}

export function integer(value: unknown, label: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new Error(`${label} is outside its contract`)
	}
	return Number(value)
}

export function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${label} is not a boolean`)
	return value
}

export function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
		throw new Error(`${label} is not a string array`)
	}
	return value
}

export function pageImage(page: DecodedPage): DocumentModelImage {
	if (!page.image) throw new Error(`rendered image for page ${page.page} is missing`)
	return { page: page.page, ...page.image }
}

export function joinedText(pages: ExtractedPage[]): string {
	let joined = ''
	for (const page of pages) {
		const separator = joined === '' ? '' : '\n\n'
		const prefix = joined + separator
		const remaining = MAX_MODEL_DOCUMENT_TEXT_BYTES - utf8Length(prefix)
		if (remaining <= 0) break
		const bytes = new TextEncoder().encode(page.text)
		if (bytes.length <= remaining) {
			joined = prefix + page.text
			continue
		}
		let tail = new TextDecoder().decode(bytes.subarray(0, remaining))
		while (tail && utf8Length(prefix + tail) > MAX_MODEL_DOCUMENT_TEXT_BYTES) {
			tail = tail.slice(0, -1)
		}
		joined = prefix + tail
		break
	}
	return joined
}

export function pointerExists(value: unknown, pointer: string): boolean {
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

export function extractionEvidence(
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
