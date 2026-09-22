import { readFile } from 'node:fs/promises'
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { ServerDocumentDecoder } from '../../src/server'

GlobalFonts.removeAll()
const path = process.argv[2]
if (!path) throw new Error('PDF path argument required')
const bytes = new Uint8Array(await readFile(path))
const decoded = await new ServerDocumentDecoder().decode(
	{
		artifactId: '11111111-1111-4111-8111-111111111111',
		originalName: path.split('/').at(-1) ?? 'golden.pdf',
		declaredMediaType: 'application/pdf',
		base64: Buffer.from(bytes).toString('base64')
	},
	{ modelPageLimit: 15 }
)
const textPixels = await Promise.all(
	decoded.pages.map(async (page) => {
		if (!page.image) return 0
		const image = await loadImage(Buffer.from(page.image.base64, 'base64'))
		const canvas = createCanvas(image.width, image.height)
		const context = canvas.getContext('2d')
		context.drawImage(image, 0, 0)
		const pixels = context.getImageData(0, 0, image.width, Math.floor(image.height / 2)).data
		let dark = 0
		for (let i = 0; i < pixels.length; i += 4)
			if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) dark++
		return dark
	})
)
console.log(
	JSON.stringify({
		outcome: decoded.outcome,
		systemFonts: GlobalFonts.families.length,
		textPixels,
		pages: decoded.pages.length,
		runs: decoded.pages.reduce((sum, page) => sum + page.runs.length, 0),
		images: decoded.pages.map((page) => Buffer.from(page.image?.base64 ?? '', 'base64').length)
	})
)
