import { type Stage, stage } from '../../pipeline/types'
import type { IngestorPorts } from '../ports'

/** Raw bytes handed to the pipeline (e.g. from a file input or fetch). */
export interface RawSource {
	filename: string
	mimeType?: string
	bytes: Uint8Array
}

/** Source after it has been hashed + persisted — the provenance anchor. */
export interface SourceDoc {
	filename: string
	mimeType: string
	bytes: Uint8Array
	contentSha256: string
	fileId: string
}

/**
 * Stage 1 — hash the source content and persist it via the uploader port. The
 * content hash is the idempotency anchor; the returned `fileId` is the durable
 * pointer recorded on every target row.
 */
export function makeIngestStage(ports: IngestorPorts): Stage<RawSource, SourceDoc> {
	return stage('ingest', async (input, ctx) => {
		const contentSha256 = await ports.hash.sha256Hex(input.bytes)
		const mimeType = input.mimeType ?? 'text/csv'
		const { fileId } = await ports.uploader.upload({
			filename: input.filename,
			mimeType,
			bytes: input.bytes,
			contentSha256
		})
		ctx.logger.log('info', 'ingest', `persisted ${input.filename}`, { fileId, contentSha256 })
		return { filename: input.filename, mimeType, bytes: input.bytes, contentSha256, fileId }
	})
}
