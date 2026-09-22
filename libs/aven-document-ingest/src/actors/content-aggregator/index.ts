import { Actor } from '@avenos/actors'
import type { PageClassification } from '../../shared'
import { artifact, failure, manifest, success, wholeArtifact } from '../../shared'

export const CONTENT_AGGREGATOR_MANIFEST = manifest(
	'content-aggregator',
	'Content aggregator',
	'Combines every page classification without inventing missing knowledge.',
	'document_aggregate_content',
	[
		'ceo.aven.docs.file(F)',
		'ceo.aven.docs.content_classification(P, C)',
		'ceo.aven.docs.document_text(F, T)'
	],
	['ceo.aven.docs.content_classification(F, C)']
)

export function createContentAggregatorActor(): Actor {
	return new Actor(structuredClone(CONTENT_AGGREGATOR_MANIFEST), {
		document_aggregate_content: (payload) => {
			try {
				const pages = payload.pages as unknown as PageClassification[]
				const kinds = new Set(pages.map((page) => page.primaryKind))
				// Blank pages do not change a known content kind. Preserve explicit
				// uncertainty; heterogeneous known page kinds form mixed content.
				if (kinds.size > 1) kinds.delete('blank')
				const primaryKind =
					kinds.size === 0 || kinds.has('unknown')
						? 'unknown'
						: kinds.size === 1
							? [...kinds][0]!
							: 'mixed'
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
	})
}
