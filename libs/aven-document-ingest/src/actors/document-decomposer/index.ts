import { Actor } from '@avenos/actors'
import type { DecodedDocument } from '../../shared'
import {
	artifact,
	failure,
	manifest,
	normalizedDimensions,
	success,
	wholeArtifact,
	wholePage
} from '../../shared'

export const DOCUMENT_DECOMPOSER_MANIFEST = manifest(
	'document-decomposer',
	'Document decomposer',
	'Turns a readable document into stable logical page artifacts.',
	'document_decompose',
	['ceo.aven.docs.file(F)', 'ceo.aven.docs.file_inspection(F, I)'],
	['ceo.aven.docs.page(F, P)']
)

export function createDocumentDecomposerActor(): Actor {
	return new Actor(structuredClone(DOCUMENT_DECOMPOSER_MANIFEST), {
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
							inputLocator:
								page.textRange && page.textRange.endExclusive > page.textRange.start
									? { kind: 'byte-range' as const, ...page.textRange }
									: wholePage(page.page)
						}))
					},
					`Decomposed ${document.pages.length} page(s).`
				)
			} catch (error) {
				return failure(error)
			}
		}
	})
}
