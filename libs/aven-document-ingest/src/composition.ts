import { Actor, type ActorStepInput, type ActorStepPayload, type Manifest } from '@avenos/actors'
import type { DocumentActors } from './actors/registry'
import {
	type DecodedDocument,
	DOCUMENT_SCHEMA_BINDINGS,
	type DocumentActorResult,
	type DocumentDecoder,
	type DocumentSource,
	type ExtractedPage,
	object
} from './shared'

/** The host reads only admitted immutable inputs; it never searches for a convenient sibling. */
export interface DocumentCompositionReader {
	content(input: ActorStepInput, maxBytes: number): Promise<Uint8Array>
	producer(
		input: ActorStepInput
	): Promise<{ runId: string; inputs: Array<{ artifactId: string; role: string }> }>
	assertSource(input: ActorStepInput, sourceId: string): Promise<void>
	ownedPages(input: ActorStepInput): Promise<number[]>
}

export function createDocumentCompositionActor(
	manifest: Manifest,
	actors: DocumentActors,
	decoder: DocumentDecoder,
	reader: DocumentCompositionReader
): Actor {
	const implementation = actors.all.find((a) => a.manifest.id === manifest.id)
	if (!implementation) throw Error('DOCUMENT_MODEL_UNAVAILABLE')
	return new Actor(
		manifest,
		Object.fromEntries(
			manifest.methods.map((method) => [
				method.name,
				async (payload: Record<string, unknown>) => {
					const call = payload as unknown as ActorStepPayload
					const members = call.inputMembers
					if (!members) throw Error('DOCUMENT_NAMED_INPUTS_REQUIRED')
					const one = (name: string) => {
						const values = members[name]
						if (values?.length !== 1) throw Error('DOCUMENT_INPUT_REQUIRED:' + name)
						return values[0]!
					}
					const value = (name: string) => one(name).value
					let source: DocumentSource | undefined
					if (members.source) {
						const input = one('source'),
							metadata = object(input.value, 'source')
						for (const member of Object.values(members).flat())
							if (member.artifactId !== input.artifactId)
								await reader.assertSource(member, input.artifactId)
						const bytes = await reader.content(input, 128 * 1024 * 1024)
						source = {
							artifactId: input.artifactId,
							originalName: String(metadata.originalName),
							declaredMediaType: String(metadata.declaredMediaType),
							base64: toBase64(bytes)
						}
					}
					let metadata: DecodedDocument | undefined
					const document = async () => {
						if (!source) throw Error('DOCUMENT_SOURCE_REQUIRED')
						metadata ??= await decoder.decode(source, { modelPageLimit: 0, metadataOnly: true })
						return metadata
					}
					const page = async (input: ActorStepInput) => {
						const number = object(input.value, 'page').sourcePage
						const decoded = (await document()).pages.find((p) => p.page === number)
						if (!decoded) throw Error('DOCUMENT_PAGE_NOT_IN_SOURCE')
						return decoded
					}
					const extracted = async (): Promise<ExtractedPage[]> => {
						const texts = members.text ?? [],
							layouts = members.layout ?? []
						const usedLayouts = new Set<string>()
						const result: ExtractedPage[] = []
						for (const text of texts) {
							const producer = await reader.producer(text)
							const matches: ActorStepInput[] = []
							for (const layout of layouts)
								if ((await reader.producer(layout)).runId === producer.runId) matches.push(layout)
							if (matches.length !== 1) throw Error('DOCUMENT_TEXT_LAYOUT_PAIR_REQUIRED')
							const layout = matches[0]!
							if (usedLayouts.has(layout.artifactId)) throw Error('DOCUMENT_DUPLICATE_PAGE')
							usedLayouts.add(layout.artifactId)
							const pageId = producer.inputs.find((i) => i.role === 'page')?.artifactId
							const boundPage = members.page?.find((p) => p.artifactId === pageId)
							if (!boundPage) throw Error('DOCUMENT_TEXT_PAGE_MISMATCH')
							const l = object(layout.value, 'layout'),
								t = object(text.value, 'text')
							const spans = l.spans as ExtractedPage['spans']
							const number = boundPage
								? Number(object(boundPage.value, 'page').sourcePage)
								: spans[0]?.page
							if (!number || spans.some((s) => s.page !== number) || t.pageCount !== 1)
								throw Error('DOCUMENT_PAGE_REPRESENTATION_REQUIRED')
							result.push({
								page: number,
								text: new TextDecoder('utf-8', { fatal: true }).decode(
									await reader.content(text, 2_000_000)
								),
								method: t.method === 'ocr' ? 'ocr' : 'native',
								spans,
								complete: t.complete === true && l.complete === true
							})
						}
						if (
							!result.length ||
							result.length !== members.page?.length ||
							usedLayouts.size !== layouts.length ||
							new Set(result.map((p) => p.page)).size !== result.length
						)
							throw Error('DOCUMENT_PAGE_REPRESENTATION_REQUIRED')
						return result.sort((a, b) => a.page - b.page)
					}
					let input: Record<string, unknown>
					// A validation may only be applied to the exact candidate that produced it.
					if (members.candidate && members.validation)
						await reader.assertSource(one('validation'), one('candidate').artifactId)
					if (
						members.candidate?.length === 1 &&
						members.details?.length === 1 &&
						!method.name.startsWith('document_merge_') &&
						(await reader.producer(one('candidate'))).runId !==
							(await reader.producer(one('details'))).runId
					)
						throw Error('DOCUMENT_CANDIDATE_DETAILS_MISMATCH')
					if (members.page?.length === 1 && members.text?.length === 1)
						await reader.assertSource(one('text'), one('page').artifactId)
					switch (method.name) {
						case 'document_merge_kinds':
							input = { parts: members['document-classification']!.map((p) => p.value) }
							break
						case 'document_merge_invoice':
						case 'document_merge_statement': {
							const candidates = members.candidate!,
								details = members.details ?? []
							if (
								!candidates.length ||
								new Set(candidates.map((c) => c.artifactId)).size !== candidates.length ||
								(details.length && details.length !== candidates.length)
							)
								throw Error('DOCUMENT_CHUNK_SET_INVALID')
							const parts = []
							const owned = new Set<number>()
							for (const [index, candidate] of candidates.entries()) {
								for (const page of await reader.ownedPages(candidate)) {
									if (owned.has(page)) throw Error('DOCUMENT_CHUNK_PAGES_OVERLAP')
									owned.add(page)
								}
								const detail = details[index]
								if (
									detail &&
									(await reader.producer(candidate)).runId !== (await reader.producer(detail)).runId
								)
									throw Error('DOCUMENT_CHUNK_PAIR_MISMATCH')
								parts.push({ candidate: candidate.value, ...(detail && { details: detail.value }) })
							}
							input = { parts }
							break
						}
						case 'document_inspect':
							input = { source, modelPageLimit: 0 }
							break
						case 'document_decompose':
							// Re-derive immutable source metadata; the exact inspection remains a causal gate.
							if (
								object(value('inspection'), 'inspection').outcome &&
								object(value('inspection'), 'inspection').outcome !== 'ok'
							)
								throw Error('DOCUMENT_INSPECTION_NOT_READABLE')
							input = { document: await document() }
							break
						case 'document_extract_native_text':
							input = { source, page: await page(one('page')) }
							break
						case 'document_classify_page':
							input = {
								page: await page(one('page')),
								mediaType: source!.declaredMediaType,
								extracted: {
									text: new TextDecoder().decode(await reader.content(one('text'), 2_000_000))
								}
							}
							break
						case 'document_analyze_page':
							input = { source, page: await page(one('page')), extracted: (await extracted())[0] }
							break
						case 'document_assemble':
							input = { pages: await extracted() }
							break
						case 'document_aggregate_content':
							input = { pages: members['page-classification']!.map((p) => p.value) }
							break
						case 'document_classify_kind':
						case 'document_extract_invoice':
						case 'document_extract_statement': {
							const pages = await extracted(),
								selected = await Promise.all(members.page!.map(page))
							if (
								selected.length > 32 ||
								selected.length !== pages.length ||
								selected.some((p) => !pages.some((t) => t.page === p.page))
							)
								throw Error('DOCUMENT_MODEL_BATCH_REQUIRES_UP_TO_32_MATCHED_PAGES')
							input = {
								source,
								document: { ...(await document()), pages: selected },
								pages,
								...(members['document-classification'] && {
									expectedKind: object(value('document-classification'), 'classification')
										.resolvedKind
								})
							}
							break
						}
						case 'document_detect_csv_statement':
						case 'document_map_csv_statement':
							input = { source }
							break
						case 'document_admit_csv_statement':
							input = {
								detection: value('detection'),
								confirmation: value('confirmation'),
								detectionArtifactId: one('detection').artifactId
							}
							break
						case 'reconciliation_rank_invoice_transactions':
							input = {
								openItem: value('open-item'),
								transactions: members.transaction!.map((t) => t.value)
							}
							break
						default:
							input = Object.fromEntries(
								Object.entries(members).map(([name]) => [name, value(name)])
							)
					}
					Object.assign(input, call.parameters)
					const response = await implementation.deliver(method.name, input)
					const result = JSON.parse(response.record) as
						| DocumentActorResult
						| { ok: false; error: string }
					if (!result.ok) return response
					const outputs: Record<string, unknown> = {},
						blobs: Record<string, unknown> = {},
						keys = new Map<string, string>()
					for (const slot of method.outputSlots!) {
						const type = Object.values(DOCUMENT_SCHEMA_BINDINGS).find(
							(b) => b.schema === slot.schema
						)!
						const values = result.artifacts
							.filter(
								(a) =>
									a.output.role === slot.role &&
									a.typeKey === type.typeKey &&
									a.typeVersion === type.typeVersion
							)
							.sort((a, b) => a.output.ordinal - b.output.ordinal)
						if (slot.cardinality === 'one' && values.length !== 1)
							throw Error('DOCUMENT_OUTPUT_CARDINALITY')
						outputs[slot.name] =
							slot.cardinality === 'many'
								? values.map((a) => a.payload)
								: (values[0]?.payload ?? null)
						values.forEach((a, index) => {
							const key = slot.name + '-' + index
							keys.set(a.localKey, key)
							if (a.blob) blobs[key] = a.blob
						})
					}
					if (keys.size !== result.artifacts.length) throw Error('DOCUMENT_OUTPUT_NOT_DECLARED')
					return {
						wire: response.wire,
						record: JSON.stringify({
							ok: true,
							outputs,
							blobs,
							evidence: result.evidence.map((e) => ({
								...e,
								outputLocalKey: keys.get(e.outputLocalKey)
							})),
							...(result.modelReceipt && { modelReceipt: result.modelReceipt })
						})
					}
				}
			])
		)
	)
}

function toBase64(bytes: Uint8Array): string {
	let text = ''
	for (let offset = 0; offset < bytes.length; offset += 0x8000)
		text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
	return btoa(text)
}
