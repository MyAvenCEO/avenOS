import { Actor } from '@avenos/actors'
import { type ChunkPart, mergeFinance, renderedDocument } from '../../chunks'
import { type DocumentModelGateway, modelRequest } from '../../model'
import type { DecodedDocument, DocumentDecoder, DocumentSource, ExtractedPage } from '../../shared'
import {
	artifact,
	extractionEvidence,
	failure,
	joinedText,
	manifest,
	materializePage,
	object,
	pageImage,
	stringValue,
	success,
	textGroundedExtractionEvidence
} from '../../shared'

export function createStatementExtractorActor(
	model: DocumentModelGateway,
	decoder?: DocumentDecoder
): Actor {
	return new Actor(
		manifest(
			'statement-extractor',
			'Statement extractor',
			'Extracts a grounded account statement or payment receipt candidate.',
			'document_extract_statement',
			['ceo.aven.docs.file(F)', 'ceo.aven.docs.document_classification(F, C)'],
			['ceo.aven.bookkeeping.statement_candidate(F, S)']
		),
		{
			document_extract_statement: async (payload) => {
				try {
					if (Array.isArray(payload.parts)) {
						const merged = mergeFinance(payload.parts as unknown as ChunkPart[], false)
						return success(
							{
								ok: true,
								procedureKey: 'client.merge-statement-chunks',
								artifacts: merged.artifacts,
								evidence: merged.evidence
							},
							'Combined all statement chunks.'
						)
					}
					const document = await renderedDocument(
						payload.document as unknown as DecodedDocument,
						decoder,
						payload.source as unknown as DocumentSource
					)
					const observedPages = payload.pages as unknown as ExtractedPage[]
					const pages = document.pages.map((page) => {
						const native = materializePage(page)
						return native.text.trim()
							? native
							: (observedPages.find((observed) => observed.page === page.page) ?? native)
					})
					const expectedKind = stringValue(payload.expectedKind, 'expected statement kind')
					const completed = await model.complete(
						modelRequest(
							'extract-statement',
							document.pages.filter((page) => page.image).map(pageImage),
							joinedText(pages) +
								(typeof payload.context === 'string'
									? `\n<surrounding_context>\n${payload.context}\n</surrounding_context>`
									: ''),
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
					const evidenceTargets = {
						candidate: { outputLocalKey: 'statement', value: candidate }
					}
					return success(
						{
							ok: true,
							procedureKey: 'client.extract-statement-model',
							artifacts: [
								artifact('statement', 'banking.account-statement-candidate', candidate, 'candidate')
							],
							evidence: textGroundedExtractionEvidence(
								pages,
								evidenceTargets,
								extractionEvidence(completed.structured, evidenceTargets)
							),
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
}
