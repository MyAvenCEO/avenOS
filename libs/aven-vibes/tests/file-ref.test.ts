import { describe, expect, test } from 'bun:test'
import { contentHash, fileRef, filePath } from '../src/file-ref.js'

// board 0082 — the content-addressed PRIVATE file store: hash is deterministic (dedup) and the path
// is `sparks/PRIVATE/<hash>`.

const enc = (s: string) => new TextEncoder().encode(s)

describe('file-ref', () => {
	test('contentHash is deterministic for the same bytes and differs for different bytes', async () => {
		const a = await contentHash(enc('hello'))
		const b = await contentHash(enc('hello'))
		const c = await contentHash(enc('world'))
		expect(a).toBe(b) // same bytes → same hash (natural dedup)
		expect(a).not.toBe(c)
		expect(a).toMatch(/^[0-9a-f]{64}$/)
	})

	test('filePath → sparks/PRIVATE/<hash>[.ext]', async () => {
		const h = await contentHash(enc('x'))
		expect(filePath(h)).toBe(`sparks/PRIVATE/${h}`)
		expect(filePath(h, 'pdf')).toBe(`sparks/PRIVATE/${h}.pdf`)
		expect(filePath(h, '.pdf')).toBe(`sparks/PRIVATE/${h}.pdf`)
	})

	test('fileRef bundles hash + filename + mime + path', async () => {
		const r = await fileRef(enc('doc'), 'invoice.pdf', 'application/pdf')
		expect(r.path).toBe(`sparks/PRIVATE/${r.hash}.pdf`)
		expect(r.filename).toBe('invoice.pdf')
		expect(r.mime).toBe('application/pdf')
	})
})
