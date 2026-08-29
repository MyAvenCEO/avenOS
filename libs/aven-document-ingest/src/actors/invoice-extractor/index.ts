import { Actor } from '@avenos/actors'
import { type DocumentModelGateway, modelRequest } from '../../model'
import type { DecodedDocument, ExtractedPage } from '../../shared'
import {
	artifact,
	extractionEvidence,
	failure,
	joinedText,
	manifest,
	object,
	pageImage,
	stringValue,
	success
} from '../../shared'

export function createInvoiceExtractorActor(model: DocumentModelGateway): Actor {
	return new Actor(
		manifest(
			'invoice-extractor',
			'Invoice extractor',
			'Extracts a grounded compact invoice candidate and complete finance details.',
			'document_extract_invoice',
			['ceo.aven.docs.file(F)', 'ceo.aven.docs.document_classification(F, C)'],
			['ceo.aven.bookkeeping.invoice_candidate(F, I)', 'ceo.aven.bookkeeping.invoice_details(F, D)']
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
}
