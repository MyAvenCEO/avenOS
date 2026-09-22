import { Actor } from '@avenos/actors'
import { CSV_MAPPING_SCHEMA, mapCsvStatement } from '../../csv-mapping'
import {
	artifact,
	type DocumentSource,
	failure,
	manifest,
	success,
	wholeArtifact
} from '../../shared'

export const CSV_STATEMENT_MAPPER_MANIFEST = manifest(
	'csv-statement-mapper',
	'Map CSV columns',
	'Map bank CSV columns to statement fields using an explicit reusable mapping. Read source headers first; an agent may propose settings, never invent rows or infer date/sign conventions. UTF-16 bank downloads are supported. Produces a reviewable detection, not admitted transactions. Missing facts remain null. Review with the user before confirmation; then use the existing statement admission, validation and normalization Actors.',
	'document_map_csv_statement',
	['ceo.aven.docs.file(F)'],
	['ceo.aven.banking.csv_detection(F, D)'],
	['text/csv', 'application/csv', 'application/vnd.ms-excel']
)
CSV_STATEMENT_MAPPER_MANIFEST.methods[0]!.parameters = {
	type: 'object',
	additionalProperties: false,
	maxProperties: 1,
	properties: { mapping: CSV_MAPPING_SCHEMA },
	required: ['mapping']
}

export function createCsvStatementMapperActor(): Actor {
	return new Actor(structuredClone(CSV_STATEMENT_MAPPER_MANIFEST), {
		document_map_csv_statement: async (payload) => {
			try {
				const detection = await mapCsvStatement(
					payload.source as unknown as DocumentSource,
					payload.mapping
				)
				return success(
					{
						ok: true,
						procedureKey: 'client.map-csv-statement',
						artifacts: [
							artifact(
								'detection',
								'banking.csv-statement-detection',
								{ ...detection },
								'detection'
							)
						],
						evidence: [
							{
								ordinal: 0,
								outputLocalKey: 'detection',
								outputLocator: wholeArtifact(),
								inputRole: 'source',
								inputOrdinal: 0,
								inputLocator: wholeArtifact()
							}
						]
					},
					detection.reason
				)
			} catch (error) {
				return failure(error)
			}
		}
	})
}
