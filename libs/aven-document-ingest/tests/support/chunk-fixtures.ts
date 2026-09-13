/** Minimal, deterministic PDF fixtures with real page trees and text streams. */
export function textPdf(pages: string[][]): Uint8Array {
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'',
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	]
	const ids: number[] = []
	for (const lines of pages) {
		const pageId = objects.length + 1,
			streamId = pageId + 1
		ids.push(pageId)
		const stream = [
			'BT /F1 10 Tf 40 800 Td',
			...lines.map(
				(line, index) => `${index ? '0 -15 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`
			),
			'ET'
		].join('\n')
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
			`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
		)
	}
	objects[1] = `<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] >>`
	let pdf = '%PDF-1.4\n',
		offsets = [0]
	for (const [index, object] of objects.entries()) {
		offsets.push(Buffer.byteLength(pdf))
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
	}
	const xref = Buffer.byteLength(pdf)
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
		.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
	return new Uint8Array(Buffer.from(pdf))
}
export function documentSource(bytes: Uint8Array, name = 'long.pdf') {
	return {
		artifactId: crypto.randomUUID(),
		originalName: name,
		declaredMediaType: name.endsWith('.pdf') ? 'application/pdf' : 'text/plain',
		base64: Buffer.from(bytes).toString('base64')
	}
}

export function mixedPdf(
	pages: Array<string[] | { jpeg: Uint8Array; width: number; height: number }>
): Uint8Array {
	const objects: Buffer[] = [
		Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
		Buffer.alloc(0),
		Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
	]
	const ids: number[] = []
	for (const page of pages) {
		const id = objects.length + 1
		ids.push(id)
		if (Array.isArray(page)) {
			const stream = Buffer.from(
				[
					'BT /F1 12 Tf 40 800 Td',
					...page.map(
						(line, index) => `${index ? '0 -18 Td ' : ''}(${line.replace(/[\\()]/g, '\\$&')}) Tj`
					),
					'ET'
				].join('\n')
			)
			objects.push(
				Buffer.from(
					`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
				),
				Buffer.concat([
					Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
					stream,
					Buffer.from('\nendstream')
				])
			)
		} else {
			const stream = Buffer.from('q 595 0 0 842 0 0 cm /Im1 Do Q')
			objects.push(
				Buffer.from(
					`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`
				),
				Buffer.concat([
					Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
					stream,
					Buffer.from('\nendstream')
				]),
				Buffer.concat([
					Buffer.from(
						`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
					),
					Buffer.from(page.jpeg),
					Buffer.from('\nendstream')
				])
			)
		}
	}
	objects[1] = Buffer.from(
		`<< /Type /Pages /Count ${ids.length} /Kids [${ids.map((id) => `${id} 0 R`).join(' ')}] >>`
	)
	const buffers = [Buffer.from('%PDF-1.4\n')],
		offsets: number[] = []
	let length = buffers[0]?.length
	for (const [index, object] of objects.entries()) {
		offsets.push(length)
		const buffer = Buffer.concat([
			Buffer.from(`${index + 1} 0 obj\n`),
			object,
			Buffer.from('\nendobj\n')
		])
		buffers.push(buffer)
		length += buffer.length
	}
	buffers.push(
		Buffer.from(
			`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`
		)
	)
	return new Uint8Array(Buffer.concat(buffers))
}
