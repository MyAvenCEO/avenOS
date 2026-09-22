import { decodeCsvText, isCsvSource } from '@avenos/document-ingest/csv'
import type { ArtifactProcessingPresentation } from '../artifacts/processing'
import type { SourceText } from './source-retrieval'

type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>
type Envelope = { typeKey?: string; blob?: { length?: number }; payload?: Record<string, unknown> }
const MAX_BYTES = 1024 * 1024

/** Read the whole bounded representation, never label one chunk as the document. */
export async function readStoredSource(
	artifactId: string,
	invoke: Invoke,
	processing?: Pick<ArtifactProcessingPresentation, 'state' | 'derivedArtifacts'> &
		Partial<Pick<ArtifactProcessingPresentation, 'metadata'>>
): Promise<SourceText> {
	const envelope = await invoke<Envelope>('artifact_get', { artifactId })
	const generated =
		envelope.typeKey === 'ai.completion' || envelope.payload?.sourceKind === 'actor-authored'
	const media = String(envelope.payload?.declaredMediaType ?? envelope.payload?.mediaType ?? '')
	const csv =
		envelope.typeKey === 'core.file' &&
		isCsvSource({
			originalName: String(envelope.payload?.originalName ?? ''),
			declaredMediaType: media
		})
	let targets = [artifactId]
	let complete = true
	let expectedPages: number | undefined
	let representedPages = 0
	if (
		envelope.payload &&
		(!envelope.blob ||
			(envelope.typeKey !== 'core.file' && envelope.typeKey !== 'docs.extracted-text'))
	) {
		const content = JSON.stringify(envelope.payload, null, 2)
		if (new TextEncoder().encode(content).length > MAX_BYTES)
			throw new Error('Structured source exceeds the 1 MiB read limit')
		return { content, complete: true, textArtifactId: artifactId, ...(generated && { generated }) }
	}
	if (
		envelope.typeKey !== 'docs.extracted-text' &&
		!csv &&
		!media.startsWith('text/') &&
		!/json|xml|message\/rfc822/.test(media)
	) {
		if (!processing)
			throw new Error('Document processing is not restored yet; text coverage is unavailable')
		targets = [
			...new Set(
				processing.derivedArtifacts
					.filter(
						(a) => a.typeKey === 'docs.extracted-text' && a.stageKey.startsWith('assemble-document')
					)
					.toSorted(
						(a, b) =>
							Number(a.stageKey.replace('assemble-document', '').replace('-', '') || 0) -
							Number(b.stageKey.replace('assemble-document', '').replace('-', '') || 0)
					)
					.map((a) => a.artifactId) ?? []
			)
		]
		if (!targets.length)
			throw new Error('Document text has not been assembled; search coverage is incomplete')
		if (targets.length > 256)
			throw new Error('Document has too many text chunks; search coverage is incomplete')
		// Text coverage is independent of classification/finance review. Count every
		// assembled page against inspection; successful chunks alone are insufficient.
		expectedPages = Number(processing.metadata?.pageCount)
		complete =
			processing.state !== 'active' && Number.isSafeInteger(expectedPages) && expectedPages > 0
	}
	let content = '',
		bytesRead = 0
	const chunks: NonNullable<SourceText['chunks']> = []
	for (const id of targets) {
		const doc =
			id === artifactId ? envelope : await invoke<Envelope>('artifact_get', { artifactId: id })
		if (expectedPages !== undefined) {
			const pages = Number(doc.payload?.pageCount)
			complete &&= Number.isSafeInteger(pages) && pages > 0 && doc.payload?.complete === true
			representedPages += pages
		}
		const separator = chunks.length ? '\n\n' : ''
		bytesRead += separator.length
		if (bytesRead + Number(doc.blob?.length ?? doc.payload?.length ?? 0) > MAX_BYTES)
			throw new Error('Source exceeds the 1 MiB read limit; search coverage is incomplete')
		const body = await invoke<{ base64: string }>('artifact_content_get', {
			artifactId: id,
			maxBytes: MAX_BYTES - bytesRead
		})
		if (body.base64.length > Math.ceil(((MAX_BYTES - bytesRead) * 4) / 3) + 4)
			throw new Error('Source exceeds the 1 MiB read limit')
		const bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0))
		bytesRead += bytes.length
		if (bytesRead > MAX_BYTES) throw new Error('Source exceeds the 1 MiB read limit')
		const text =
			doc.typeKey === 'core.file' &&
			isCsvSource({
				originalName: String(doc.payload?.originalName ?? ''),
				declaredMediaType: String(doc.payload?.declaredMediaType ?? '')
			})
				? decodeCsvText(bytes)
				: new TextDecoder('utf-8', { fatal: true }).decode(bytes)
		content += separator
		chunks.push({
			artifactId: id,
			start: content.length,
			endExclusive: content.length + text.length
		})
		content += text
		complete &&= doc.payload?.complete !== false
	}
	return {
		content,
		complete: complete && (expectedPages === undefined || representedPages === expectedPages),
		...(generated && { generated }),
		...(targets.length === 1 ? { textArtifactId: targets[0] } : { chunks })
	}
}
