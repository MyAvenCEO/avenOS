import type { ExecutionEnvironment } from '@avenos/actors'
import { documentRunStartRequest } from '@avenos/document-ingest/execution'

/** Upload and reopen use the same immutable admission identity, regardless of an edited title. */
export async function immutableDocumentRunRequest(
	source: { artifactId: string; originalName: string; declaredMediaType?: string },
	environment: ExecutionEnvironment,
	readSource: (
		artifactId: string
	) => Promise<{ payload: { originalName: string; declaredMediaType: string } }>
) {
	const { payload } = await readSource(source.artifactId)
	if (typeof payload.originalName !== 'string' || typeof payload.declaredMediaType !== 'string') {
		throw new Error('The source document has no immutable name or media type')
	}
	return documentRunStartRequest(
		{
			artifactId: source.artifactId,
			originalName: payload.originalName,
			declaredMediaType: payload.declaredMediaType
		},
		environment
	)
}
