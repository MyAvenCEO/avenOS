import { expect, mock, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

mock.module('../src/lib/artifacts/pdf', () => ({
	base64ToBytes: (s: string) => new Uint8Array(Buffer.from(s, 'base64')),
	loadOwnedPdf: () => {
		throw new Error('PDF is not part of this JPEG test')
	}
}))
const { BrowserDocumentDecoder } = await import('../src/lib/artifacts/browser-document-decoder')
test('browser camera JPEG retains bytes beyond the EXIF thumbnail', async () => {
	const bytes = await readFile(new URL('../../fixtures/artifacts/IM_00140.JPG', import.meta.url))
	const decoded = await new BrowserDocumentDecoder().decode(
		{
			artifactId: crypto.randomUUID(),
			originalName: 'camera.jpg',
			base64: bytes.toString('base64')
		},
		{ modelPageLimit: 1 }
	)
	expect(Buffer.from(decoded.pages[0]?.image?.base64, 'base64').byteLength).toBe(1583804)
})
