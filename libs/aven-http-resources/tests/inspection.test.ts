import { expect, it } from 'vitest'
import { inspectHttpData } from '../src/inspection'

function inspect(body: string | Uint8Array, patch: Record<string, unknown> = {}) {
	const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
	return inspectHttpData(
		{
			requestedUrl: 'https://orchard.example.test/count',
			finalUrl: 'https://orchard.example.test/count',
			statusCode: 200,
			cacheDisposition: 'new',
			declaredMediaType: 'application/json',
			declaredCharset: 'utf-8',
			etag: null,
			lastModified: null,
			headers: [],
			redirectCount: 0,
			storedBodyLength: bytes.length,
			capturedAt: '2026-02-03T10:00:00Z',
			...patch
		},
		bytes
	)
}
it('inspects JSON syntax without asserting domain success or changing bytes', () => {
	expect(inspect('{"count":23}').outcome).toBe('supported')
	expect(inspect('{"error":"missing"}', { statusCode: 404 }).outcome).toBe('supported')
	expect(
		inspect('{"error":"missing"}', { declaredMediaType: 'application/problem+json' })
			.detectedMediaType
	).toBe('application/json')
	expect(inspect('{broken').outcome).toBe('mismatch')
	expect(inspect('null', { declaredMediaType: null }).outcome).toBe('supported')
	expect(inspect('', { statusCode: 204 }).outcome).toBe('no-content')
})
it('does not guess an encoding, render HTML, or mistake binary bytes for text', () => {
	expect(inspect(new Uint8Array([0xff, 0xfe])).reason).toBe('encoding')
	expect(inspect('plain text', { declaredCharset: 'iso-8859-1' }).outcome).toBe('unsupported')
	expect(inspect('ordinary text', { declaredMediaType: 'text/plain' }).outcome).toBe('supported')
	expect(inspect('<script>fetch("/")</script>', { declaredMediaType: 'text/html' }).outcome).toBe(
		'unsupported'
	)
	expect(inspect('\u0000', { declaredMediaType: 'text/plain' }).reason).toBe('encoding')
	expect(inspect('ordinary text', { declaredMediaType: null }).outcome).toBe('unsupported')
	expect(() => inspect('text', { storedBodyLength: 999 })).toThrow('MISMATCH')
	expect(() => inspect(new Uint8Array(4194305))).toThrow('LIMIT')
})
