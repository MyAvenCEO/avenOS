import { Actor } from '@avenos/actors'
import type { ExtractedPage } from '../../shared'
import {
	artifact,
	bytesToBase64,
	failure,
	MAX_LAYOUT_SPANS,
	MAX_TEXT_BYTES,
	manifest,
	success,
	utf8Length,
	wholeArtifact
} from '../../shared'

export function createDocumentAssemblerActor(): Actor {
	return new Actor(
		manifest(
			'document-assembler',
			'Document assembler',
			'Assembles page representations into one bounded document representation.',
			'document_assemble',
			['ceo.aven.docs.extracted_text(F, P, T)'],
			['ceo.aven.docs.document_text(F, T)', 'ceo.aven.docs.document_layout(F, L)']
		),
		{
			document_assemble: (payload) => {
				try {
					const pages = payload.pages as unknown as ExtractedPage[]
					const groups: ExtractedPage[][] = []
					let group: ExtractedPage[] = [],
						bytes = 0,
						count = 0
					for (const page of pages) {
						const size = utf8Length(page.text) + (group.length ? 2 : 0)
						if (
							group.length &&
							(bytes + size > MAX_TEXT_BYTES || count + page.spans.length > MAX_LAYOUT_SPANS)
						) {
							groups.push(group)
							group = []
							bytes = 0
							count = 0
						}
						group.push(page)
						bytes += utf8Length(page.text) + (group.length > 1 ? 2 : 0)
						count += page.spans.length
					}
					if (group.length) groups.push(group)
					if (!groups.length || groups.length > 32)
						throw new Error('Document representation requires a bounded page batch')
					const artifacts = groups.flatMap((pages, ordinal) => {
						let text = ''
						const spans: ExtractedPage['spans'] = []
						for (const page of pages) {
							const separator = text === '' ? '' : '\n\n'
							const offset = utf8Length(text + separator)
							text += separator + page.text
							spans.push(
								...page.spans.map((span) => ({
									...span,
									start: span.start + offset,
									endExclusive: span.endExclusive + offset
								}))
							)
						}
						const complete = pages.every((page) => page.complete)
						const suffix = ordinal ? `-${ordinal}` : ''
						return [
							artifact(
								`text${suffix}`,
								'docs.extracted-text',
								{
									method: pages.some((page) => page.method === 'ocr') ? 'ocr' : 'native',
									language: 'und',
									pageCount: pages.length,
									characterCount: [...text].length,
									complete
								},
								'text',
								ordinal,
								{
									mediaType: 'text/plain; charset=utf-8',
									base64: bytesToBase64(new TextEncoder().encode(text))
								}
							),
							artifact(
								`layout${suffix}`,
								'docs.text-layout',
								{ coordinateSpace: 'normalized-millionths', spans, complete },
								'layout',
								ordinal
							)
						]
					})
					return success(
						{
							ok: true,
							procedureKey: 'client.assemble-document-representation',
							artifacts,
							evidence: artifacts.map((output, ordinal) => ({
								ordinal,
								outputLocalKey: output.localKey,
								outputLocator: wholeArtifact(),
								inputRole: 'source',
								inputOrdinal: 0,
								inputLocator: wholeArtifact()
							}))
						},
						`Assembled all ${pages.length} pages in ${groups.length} representation chunks.`
					)
				} catch (error) {
					return failure(error)
				}
			}
		}
	)
}
