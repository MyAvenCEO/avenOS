import { readFile } from 'node:fs/promises'
import { loadImage } from '@napi-rs/canvas'
import { describe, expect, test } from 'vitest'
import {
	boundedDocument,
	jpegVisualBytes,
	MAX_DECODED_BYTES,
	normalizedRun,
	renderScale
} from '../src/decoding'
import { ServerDocumentDecoder } from '../src/server'

describe('document decoding regression boundaries', () => {
	test('preserves the full camera JPEG past its EXIF thumbnail', async () => {
		const bytes = await readFile(
			new URL('../../../fixtures/artifacts/IM_00140.JPG', import.meta.url)
		)
		const visual = jpegVisualBytes(new Uint8Array([...bytes, 1, 2, 3]))!
		expect(visual.byteLength).toBe(1583804) // Full image EOI, before vendor trailing data.
		const decoded = await new ServerDocumentDecoder().decode(
			{
				artifactId: crypto.randomUUID(),
				originalName: 'camera.jpg',
				declaredMediaType: 'image/jpeg',
				base64: bytes.toString('base64')
			},
			{ modelPageLimit: 1 }
		)
		const image = await loadImage(Buffer.from(decoded.pages[0]?.image?.base64, 'base64'))
		expect([image.width, image.height]).toEqual([3840, 2160])
	})
	test('maps text through cropped and rotated PDF viewports', () => {
		const item = { str: 'amount', transform: [10, 0, 0, 10, 20, 30], width: 40, height: 10 }
		expect(
			normalizedRun(item, { width: 100, height: 200, transform: [1, 0, 0, -1, -10, 200] })
		).toMatchObject({ x: 100000, y: 800000, width: 400000, height: 50000 })
		expect(
			normalizedRun(item, { width: 200, height: 100, transform: [0, 1, 1, 0, 0, -10] })
		).toMatchObject({ x: 150000, y: 100000, width: 50000, height: 400000 })
	})
	test('bounds canvas allocations before rendering and degrades oversized inspection blobs', () => {
		const scale = renderScale(1000, 2000, 63)
		expect(1000 * 2000 * scale * scale).toBeLessThanOrEqual(4_000_001)
		const document = {
			outcome: 'ok' as const,
			detectedMediaType: 'application/pdf',
			encrypted: false,
			pages: [1, 2, 3].map((page) => ({
				page,
				rotation: 0 as const,
				width: 1000,
				height: 1000,
				runs: [{ text: 'retained text', x: 0, y: 0, width: 1, height: 1 }],
				image: {
					mediaType: 'image/png' as const,
					base64: Buffer.alloc(7 * 1024 * 1024).toString('base64')
				}
			}))
		}
		const bounded = boundedDocument(document)
		expect(bounded.pages.every((page) => !page.image)).toBe(true)
		expect(bounded.pages[0]?.runs[0]?.text).toBe('retained text')
		expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThan(MAX_DECODED_BYTES)
	})
})

function rotatedPdf(rotation: number, prefix = ''): Uint8Array {
	const content = 'BT /F1 10 Tf 20 30 Td (Amount) Tj ET'
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /CropBox [10 0 100 200] /Rotate ${rotation} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
		`<< /Length ${content.length} >>\nstream\n${content}\nendstream`
	]
	let pdf = `${prefix}%PDF-1.4\n`
	const offsets = [0]
	for (const [index, object] of objects.entries()) {
		offsets.push(pdf.length)
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
	}
	const xref = pdf.length
	pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
		.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return Buffer.from(pdf)
}
test('real cropped PDF rotation preserves the displayed text region, including a leading header offset', async () => {
	const decode = (rotation: number, prefix = '') =>
		new ServerDocumentDecoder().decode(
			{
				artifactId: crypto.randomUUID(),
				originalName: 'mislabelled.txt',
				declaredMediaType: 'text/plain',
				base64: Buffer.from(rotatedPdf(rotation, prefix)).toString('base64')
			},
			{ modelPageLimit: 0 }
		)
	const normal = await decode(0),
		rotated = await decode(90, ' \n')
	expect(rotated.detectedMediaType).toBe('application/pdf')
	expect(rotated.pages[0]).toMatchObject({ rotation: 90, width: 200, height: 90 })
	const a = normal.pages[0]!.runs[0]!,
		b = rotated.pages[0]!.runs[0]!
	expect(a.text).toBe('Amount')
	expect(b.text).toBe(a.text)
	expect(Math.abs(b.x - (1_000_000 - a.y - a.height))).toBeLessThanOrEqual(2)
	expect(Math.abs(b.y - a.x)).toBeLessThanOrEqual(2)
	expect(Math.abs(b.width - a.height)).toBeLessThanOrEqual(2)
	expect(Math.abs(b.height - a.width)).toBeLessThanOrEqual(2)
})
