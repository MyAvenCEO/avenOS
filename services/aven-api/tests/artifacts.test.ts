import { describe, expect, test } from 'vitest'
import { ArtifactFileService } from '../src/lib/server/artifacts/service'

const scopeId = '11111111-1111-4111-8111-111111111111'
const publicationId = '22222222-2222-4222-8222-222222222222'
const artifactId = '33333333-3333-4333-8333-333333333333'
const intentId = '44444444-4444-4444-8444-444444444444'
const intentArtifactId = '55555555-5555-4555-8555-555555555555'
const observedAt = '2026-08-24T12:00:00.000Z'
const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

describe('artifact file coordinator', () => {
	test('streams bytes and publishes an authenticated core.file root', async () => {
		let uploaded = ''
		let published: Record<string, unknown> | undefined
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			expect(request.headers.get('authorization')).toBe('Bearer service-token')
			expect(request.headers.get('x-aven-artifact-database')).toBe('cust_acme')

			if (request.url.endsWith('/v1/context')) {
				return new Response('{"storeEpoch":"epoch-1"}')
			}
			if (request.url.includes('/uploads/')) {
				expect(request.headers.get('content-length')).toBe('5')
				expect(request.headers.get('content-type')).toBe('text/plain')
				expect(request.headers.get('x-expected-sha256')).toBe(sha256)
				uploaded = await request.text()
				return new Response(`{"length":5,"sha256":"${sha256}"}`)
			}
			if (request.url.endsWith(`/publications/${publicationId}`)) {
				expect(request.headers.get('if-artifact-store-epoch')).toBe('epoch-1')
				published = JSON.parse(await request.text()) as Record<string, unknown>
				return new Response(
					`{"artifacts":[{"artifactId":"${artifactId}","localKey":"file"},{"artifactId":"${intentArtifactId}","localKey":"intent"}],` +
						`"publicationId":"${publicationId}","replayed":false,"scopeSequence":7}`
				)
			}
			throw new Error(`Unexpected Artifact Store request: ${request.url}`)
		}
		const service = ArtifactFileService.fromConfig(
			{
				ARTIFACT_STORE_BASE_URL: 'http://artifact-store.test',
				ARTIFACT_STORE_BEARER_TOKEN: 'service-token'
			},
			fetch
		)
		expect(service).not.toBeNull()

		const receipt = await service?.publishFile({
			userId: 'user-7',
			databaseName: 'cust_acme',
			scopeId,
			publicationId,
			intentId,
			observedAt,
			originalName: 'contract.pdf',
			mediaType: 'text/plain',
			sha256,
			length: 5,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('hello'))
					controller.close()
				}
			})
		})

		expect(uploaded).toBe('hello')
		expect(receipt).toEqual({
			publicationId,
			intentId,
			intentDeclarationArtifactId: intentArtifactId,
			artifactId,
			originalName: 'contract.pdf',
			mediaType: 'text/plain',
			sha256,
			length: 5,
			scopeSequence: 7,
			replayed: false
		})
		const intent = published?.intent as Record<string, unknown>
		expect(intent.scopeId).toBe(scopeId)
		expect(intent.rootActor).toEqual({ kind: 'user', id: 'user:user-7' })
		expect(intent.artifacts).toEqual([
			{
				localKey: 'file',
				typeKey: 'core.file',
				typeVersion: 1,
				payload: {
					originalName: 'contract.pdf',
					declaredMediaType: 'text/plain',
					sourceKind: 'desktop-drop'
				},
				blob: { sha256, length: 5 },
				references: [],
				output: null
			},
			{
				localKey: 'intent',
				typeKey: 'intent.declaration',
				typeVersion: 1,
				payload: { intentId, title: 'contract.pdf', triggerKind: 'file-upload', observedAt },
				blob: null,
				references: [],
				output: null
			}
		])
	})

	test('browses the committed artifact feed newest first', async () => {
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			expect(request.headers.get('authorization')).toBe('Bearer service-token')
			if (request.url.endsWith('/v1/context')) {
				return new Response(`{"storeEpoch":"${publicationId}"}`)
			}
			if (request.url.includes('/publications?')) {
				if (new URL(request.url).searchParams.get('afterSequence') !== '0') {
					return new Response(
						JSON.stringify({
							storeEpoch: publicationId,
							nextAfterSequence: null,
							items: []
						})
					)
				}
				return new Response(
					JSON.stringify({
						storeEpoch: publicationId,
						nextAfterSequence: 2,
						items: [
							{
								publicationId,
								scopeSequence: 2,
								kind: 'run',
								runId: intentId,
								inputs: [
									{ role: 'source', ordinal: 0, artifactId: intentArtifactId }
								],
								committedAt: observedAt,
								artifacts: [
									{
										artifactId,
										localKey: 'result',
										publicationOrdinal: 0,
										typeKey: 'docs.extracted-text',
										typeVersion: 1,
										artifactSha256: sha256,
										producerRunId: intentId,
										output: { role: 'result', ordinal: 0 }
									}
								]
							}
						]
					})
				)
			}
			throw new Error(`Unexpected Artifact Store request: ${request.url}`)
		}
		const service = ArtifactFileService.fromConfig(
			{
				ARTIFACT_STORE_BASE_URL: 'http://artifact-store.test',
				ARTIFACT_STORE_BEARER_TOKEN: 'service-token'
			},
			fetch
		)

		const result = await service?.browse('cust_acme', scopeId)
		expect(result).toEqual({
			storeEpoch: publicationId,
			truncated: false,
			artifacts: [
				{
					artifactId,
					localKey: 'result',
					publicationOrdinal: 0,
					typeKey: 'docs.extracted-text',
					typeVersion: 1,
					artifactSha256: sha256,
					producerRunId: intentId,
					output: { role: 'result', ordinal: 0 },
					inputs: [{ role: 'source', ordinal: 0, artifactId: intentArtifactId }],
					publicationId,
					scopeSequence: 2,
					publicationKind: 'run',
					runId: intentId,
					committedAt: observedAt
				}
			]
		})
	})
})
