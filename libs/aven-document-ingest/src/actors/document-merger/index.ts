import { Actor } from '@avenos/actors'
import { type ChunkPart, mergeFinance, mergeKinds } from '../../chunks'
import { artifact, failure, manifest, success } from '../../shared'

const kinds = manifest(
	'document-merger',
	'Document chunk merges',
	'Combine reviewed chunk results without losing any member or its lineage.',
	'document_merge_kinds',
	['ceo.aven.docs.file(F)', 'ceo.aven.docs.document_classification(F, C)'],
	['ceo.aven.docs.document_classification(F, C)']
)
const invoice = manifest(
	'document-merger',
	kinds.name,
	kinds.description,
	'document_merge_invoice',
	[
		'ceo.aven.docs.file(F)',
		'ceo.aven.bookkeeping.invoice_candidate(F, I)',
		'ceo.aven.bookkeeping.invoice_details(F, D)'
	],
	['ceo.aven.bookkeeping.invoice_candidate(F, I)', 'ceo.aven.bookkeeping.invoice_details(F, D)']
)
const statement = manifest(
	'document-merger',
	kinds.name,
	kinds.description,
	'document_merge_statement',
	['ceo.aven.docs.file(F)', 'ceo.aven.bookkeeping.statement_candidate(F, S)'],
	['ceo.aven.bookkeeping.statement_candidate(F, S)']
)
export const DOCUMENT_MERGER_MANIFEST = {
	...kinds,
	methods: [...kinds.methods, ...invoice.methods, ...statement.methods]
}

export function createDocumentMergerActor(): Actor {
	return new Actor(
		DOCUMENT_MERGER_MANIFEST,
		Object.fromEntries(
			DOCUMENT_MERGER_MANIFEST.methods.map((method) => [
				method.name,
				(payload) => {
					try {
						if (method.name === 'document_merge_kinds')
							return success(
								{
									ok: true,
									procedureKey: 'client.merge-document-kinds',
									artifacts: [
										artifact(
											'classification',
											'core.document-classification',
											mergeKinds(payload.parts as Record<string, unknown>[]),
											'classification'
										)
									],
									evidence: []
								},
								'Combined document classifications.'
							)
						const invoice = method.name === 'document_merge_invoice'
						const result = mergeFinance(payload.parts as unknown as ChunkPart[], invoice)
						return success(
							{
								ok: true,
								procedureKey: invoice
									? 'client.merge-invoice-chunks'
									: 'client.merge-statement-chunks',
								artifacts: result.artifacts,
								evidence: result.evidence
							},
							'Combined extraction chunks with their provenance.'
						)
					} catch (error) {
						return failure(error)
					}
				}
			])
		)
	)
}
