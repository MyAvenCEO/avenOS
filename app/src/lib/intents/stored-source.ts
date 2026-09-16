import type { ArtifactProcessingLookup } from '../artifacts/processing'
import type { SourceText } from './source-retrieval'

type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>
const MAX_BYTES = 1024 * 1024
/** Uses existing authenticated artifact commands. Every read resolves the current environment. */
export async function readStoredSource(artifactId: string, invoke: Invoke): Promise<SourceText> {
	const envelope = await invoke<{
		blob?: { length?: number }
		payload?: {
			mediaType?: string
			declaredMediaType?: string
			length?: number
			complete?: boolean
		}
	}>('artifact_get', { artifactId })
	const media = envelope.payload?.declaredMediaType ?? envelope.payload?.mediaType ?? ''
	let target = artifactId,
		complete = true
	if (!media.startsWith('text/') && !/json|xml|message\/rfc822/.test(media)) {
		const status = await invoke<ArtifactProcessingLookup>('artifact_processing_status', {
			artifactId
		})
		const derived =
			status.presentation?.derivedArtifacts.filter((a) => a.typeKey === 'docs.extracted-text') ?? []
		const assembled = derived.find((a) => a.stageKey === 'assemble-document')
		if (!assembled)
			throw new Error(
				'Complete document text has not been assembled; search coverage is incomplete'
			)
		target = assembled.artifactId
	}
	const doc =
		target === artifactId
			? envelope
			: await invoke<{
					blob?: { length?: number }
					payload?: { length?: number; complete?: boolean }
				}>('artifact_get', {
					artifactId: target
				})
	if ((doc.blob?.length ?? doc.payload?.length ?? 0) > MAX_BYTES)
		throw new Error('Source exceeds the 1 MiB read limit')
	complete = doc.payload?.complete !== false
	const content = await invoke<{ mediaType: string; base64: string }>('artifact_content_get', {
		artifactId: target,
		maxBytes: MAX_BYTES
	})
	if (content.base64.length > Math.ceil((MAX_BYTES * 4) / 3) + 4)
		throw new Error('Source exceeds the 1 MiB read limit')
	const bytes = Uint8Array.from(atob(content.base64), (c) => c.charCodeAt(0))
	return {
		content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
		complete,
		textArtifactId: target
	}
}
