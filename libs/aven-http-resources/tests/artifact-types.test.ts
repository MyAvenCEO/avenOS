import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { httpArtifactTypes, httpResponseSchema } from '../src/artifact-types'

it('keeps the registered Artifact Store shapes aligned with the runtime HTTP contracts', async () => {
	for (const type of httpArtifactTypes()) {
		const stored = JSON.parse(
			await readFile(
				new URL(
					`../../../services/artifact-store/conformance/fixtures/protocol/${type.typeKey}.v1.json`,
					import.meta.url
				),
				'utf8'
			)
		)
		expect(stored).toEqual(type)
	}
})
it('does not turn cache selection or a bare 304 into a new observation', () => {
	const value = {
		requestedUrl: 'https://garden.example.test/catalog',
		finalUrl: 'https://garden.example.test/catalog',
		statusCode: 200,
		cacheDisposition: 'new',
		declaredMediaType: null,
		declaredCharset: null,
		etag: null,
		lastModified: null,
		headers: [],
		redirectCount: 0,
		storedBodyLength: 12,
		capturedAt: '2026-01-06T12:00:00Z'
	}
	expect(httpResponseSchema.safeParse(value).success).toBe(true)
	for (const patch of [
		{ cacheDisposition: 'fresh-cache' },
		{ statusCode: 304 },
		{ networkStatusCode: 304 },
		{ statusCode: 204 },
		{ headers: [{ name: 'set-cookie', values: ['private'] }] }
	])
		expect(httpResponseSchema.safeParse({ ...value, ...patch }).success).toBe(false)
})
