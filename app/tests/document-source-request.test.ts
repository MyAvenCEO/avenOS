import { expect, test } from 'bun:test'
import { immutableDocumentRunRequest } from '../src/lib/artifacts/document-source-request'

test('upload and reopen with an edited Intent title produce the same immutable admission request on both hosts', async () => {
	const artifactId = '11111111-1111-4111-8111-111111111111'
	const reads: string[] = []
	const read = async (id: string) => {
		reads.push(id)
		return { payload: { originalName: 'bank-export.csv', declaredMediaType: 'text/csv' } }
	}
	for (const environment of ['local', 'server'] as const) {
		const upload = await immutableDocumentRunRequest(
			{
				artifactId,
				originalName: 'bank-export.csv',
				declaredMediaType: 'application/octet-stream'
			},
			environment,
			read
		)
		const reopen = await immutableDocumentRunRequest(
			{ artifactId, originalName: 'My renamed accounting Intent' },
			environment,
			read
		)
		const { requestId: _uploadId, requestedAt: _uploadAt, ...uploadIdentity } = upload
		const { requestId: _reopenId, requestedAt: _reopenAt, ...reopenIdentity } = reopen
		expect(reopenIdentity).toEqual(uploadIdentity)
		expect(reopen.source).toEqual({
			artifactId,
			originalName: 'bank-export.csv',
			declaredMediaType: 'text/csv'
		})
	}
	expect(reads).toEqual(Array(4).fill(artifactId))
	await expect(
		immutableDocumentRunRequest({ artifactId, originalName: 'fallback' }, 'server', async () => {
			throw new Error('source unavailable')
		})
	).rejects.toThrow('source unavailable')
})
