import { describe, expect, test } from 'vitest'
import { ArtifactProcessingService } from '../src/lib/server/artifacts/processing'

const scopeId = '11111111-1111-4111-8111-111111111111'
const artifactId = '33333333-3333-4333-8333-333333333333'

describe('artifact processing status client', () => {
	test('authenticates and preserves the tenant scope in the request', async () => {
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init)
			expect(request.url).toBe(
				`http://artifact-processor.test/v1/scopes/${scopeId}/artifacts/${artifactId}/processing`
			)
			expect(request.headers.get('authorization')).toBe('Bearer processor-token')
			expect(request.headers.get('x-aven-artifact-database')).toBe('cust_test')
			return Response.json({ state: 'succeeded', preferredType: 'invoice' })
		}
		const service = ArtifactProcessingService.fromConfig(
			{
				ARTIFACT_PROCESSOR_BASE_URL: 'http://artifact-processor.test',
				ARTIFACT_PROCESSOR_BEARER_TOKEN: 'processor-token'
			},
			fetch
		)

		await expect(service?.status('cust_test', scopeId, artifactId)).resolves.toEqual({
			state: 'succeeded',
			preferredType: 'invoice'
		})
	})

	test('maps an absent case to a stable API error', async () => {
		const service = ArtifactProcessingService.fromConfig(
			{
				ARTIFACT_PROCESSOR_BASE_URL: 'http://artifact-processor.test',
				ARTIFACT_PROCESSOR_BEARER_TOKEN: 'processor-token'
			},
			async () => new Response('not found', { status: 404 })
		)

		await expect(service?.status('cust_test', scopeId, artifactId)).rejects.toMatchObject({
			status: 404,
			code: 'ARTIFACT_PROCESSING_NOT_FOUND'
		})
	})
})
