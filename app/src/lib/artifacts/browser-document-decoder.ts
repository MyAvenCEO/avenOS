import {
	bytesToBase64,
	type DecodedDocument,
	type DecodedPage,
	type DocumentDecodeOptions,
	type DocumentDecoder,
	type DocumentSource,
	MAX_DOCUMENT_PAGES,
	pdfDecodeFailureKind
} from '@avenos/document-ingest/actors'
import {
	base64Length,
	boundedBase64,
	boundedImage,
	isPdf,
	jpegDimensions,
	jpegVisualBytes,
	MAX_FILE_BYTES,
	MAX_RENDER_BYTES,
	normalizedRun,
	pngDimensions,
	renderScale,
	normalizeRotation as rotation
} from '@avenos/document-ingest/decoding'
import { readPdfTextContent } from '@avenos/document-ingest/pdf-text'
import { base64ToBytes, loadOwnedPdf } from './pdf'
import { decodePlainText } from './plain-text-document'

async function decodePdfOnce(
	bytes: Uint8Array,
	options: DocumentDecodeOptions
): Promise<DecodedDocument> {
	const owned = await loadOwnedPdf(bytes)
	const pdf = owned.document
	try {
		// Enforce the bound before getPage/getTextContent allocate work for every
		// page. The actor repeats this check for non-browser decoder implementations.
		if (pdf.numPages > MAX_DOCUMENT_PAGES) {
			return {
				outcome: 'unsupported',
				detectedMediaType: 'application/pdf',
				encrypted: false,
				pages: []
			}
		}
		const pages: DecodedPage[] = []
		if (options.metadataOnly) {
			const metadata: DecodedPage[] = []
			for (let number = 1; number <= pdf.numPages; number++) {
				const page = await pdf.getPage(number)
				const viewport = page.getViewport({ scale: 1 })
				metadata.push({
					page: number,
					rotation: rotation(page.rotate),
					width: viewport.width,
					height: viewport.height,
					runs: [],
					deferred: true
				})
				page.cleanup()
			}
			return {
				outcome: 'ok',
				detectedMediaType: 'application/pdf',
				encrypted: false,
				pages: metadata
			}
		}
		const start = options.pageRange?.start ?? 1
		const end = Math.min(pdf.numPages, start + (options.pageRange?.count ?? pdf.numPages) - 1)
		const renderForModel =
			!options.metadataOnly &&
			options.modelPageLimit > 0 &&
			end - start + 1 <= options.modelPageLimit
		for (let number = start; number <= end; number++) {
			const page = await pdf.getPage(number)
			const viewport = page.getViewport({ scale: 1 })
			const content = await readPdfTextContent(page)
			const runs = content.items.flatMap((item) => {
				const run = normalizedRun(item, viewport)
				return run ? [run] : []
			})
			let image: DecodedPage['image']
			if (renderForModel) {
				const renderViewport = page.getViewport({
					scale: renderScale(viewport.width, viewport.height, pdf.numPages)
				})
				if (!boundedImage(Math.ceil(renderViewport.width), Math.ceil(renderViewport.height))) {
					throw new Error('rendered model page exceeds 40 million pixels')
				}
				const canvas = document.createElement('canvas')
				canvas.width = Math.ceil(renderViewport.width)
				canvas.height = Math.ceil(renderViewport.height)
				const context = canvas.getContext('2d', { alpha: false })
				if (!context) throw new Error('could not create the PDF page render context')
				await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise
				const rendered = canvas.toDataURL('image/png')
				canvas.width = 0
				canvas.height = 0
				image = {
					mediaType: 'image/png',
					base64: boundedBase64(rendered.slice(rendered.indexOf(',') + 1))
				}
			}
			pages.push({
				page: number,
				rotation: rotation(page.rotate),
				width: viewport.width,
				height: viewport.height,
				runs,
				...(image && { image })
			})
		}
		return {
			outcome: pages.length > 0 ? 'ok' : 'malformed',
			detectedMediaType: 'application/pdf',
			encrypted: false,
			pages
		}
	} finally {
		// pdf.js owns a worker and retained page resources. A long-lived actor must
		// release both after it has materialized the bounded representation.
		await owned.destroy().catch(() => undefined)
	}
}

async function decodePdf(
	bytes: Uint8Array,
	options: DocumentDecodeOptions
): Promise<DecodedDocument> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await decodePdfOnce(bytes, options)
		} catch (error) {
			const kind = pdfDecodeFailureKind(error)
			if (kind === 'encrypted') {
				return {
					outcome: 'encrypted',
					detectedMediaType: 'application/pdf',
					encrypted: true,
					pages: []
				}
			}
			if (kind === 'malformed') {
				return {
					outcome: 'malformed',
					detectedMediaType: 'application/pdf',
					encrypted: false,
					pages: []
				}
			}
			// A webview refresh can terminate a pdf.js worker between loading and
			// getTextContent. One fresh, bounded task is safe and fixes that race.
			if (kind === 'worker-lifecycle' && attempt === 0) continue
			console.warn(`PDF decoding failed because of a ${kind} decoder failure.`, error)
			throw new Error('PDF processing failed before its content could be inspected.', {
				cause: error
			})
		}
	}
	throw new Error('PDF processing exhausted its worker retry.')
}

/** Browser/webview implementation; all semantic processing stays client-side. */
export class BrowserDocumentDecoder implements DocumentDecoder {
	#base64?: string
	#bytes?: Uint8Array
	private bytes(source: DocumentSource): Uint8Array {
		if (this.#base64 !== source.base64) {
			this.#bytes = base64ToBytes(source.base64)
			this.#base64 = source.base64
		}
		return this.#bytes!
	}
	async decode(
		source: DocumentSource,
		options: DocumentDecodeOptions = { modelPageLimit: 0 }
	): Promise<DecodedDocument> {
		const bytes = this.bytes(source)
		if (bytes.length > MAX_FILE_BYTES) throw new Error('file exceeds the 128 MiB processing limit')
		if (isPdf(bytes)) {
			return decodePdf(bytes, options)
		}

		const png = pngDimensions(bytes)
		if (png && boundedImage(...png)) {
			return {
				outcome: 'ok',
				detectedMediaType: 'image/png',
				encrypted: false,
				pages: [
					{
						page: 1,
						rotation: 0,
						width: png[0],
						height: png[1],
						runs: [],
						...(options.metadataOnly && { deferred: true }),
						...(!options.metadataOnly &&
							options.modelPageLimit > 0 &&
							base64Length(source.base64) <= MAX_RENDER_BYTES && {
								image: { mediaType: 'image/png' as const, base64: boundedBase64(source.base64) }
							})
					}
				]
			}
		}
		const jpeg = jpegDimensions(bytes)
		const jpegVisual = jpeg ? jpegVisualBytes(bytes) : null
		if (jpeg && jpegVisual && boundedImage(...jpeg)) {
			return {
				outcome: 'ok',
				detectedMediaType: 'image/jpeg',
				encrypted: false,
				pages: [
					{
						page: 1,
						rotation: 0,
						width: jpeg[0],
						height: jpeg[1],
						runs: [],
						...(options.metadataOnly && { deferred: true }),
						...(!options.metadataOnly &&
							options.modelPageLimit > 0 &&
							base64Length(source.base64) <= MAX_RENDER_BYTES && {
								image: {
									mediaType: 'image/jpeg' as const,
									base64: boundedBase64(bytesToBase64(jpegVisual))
								}
							})
					}
				]
			}
		}
		const plainText = decodePlainText(source, bytes, options)
		if (plainText) return plainText
		return {
			outcome: 'unsupported',
			detectedMediaType: 'application/octet-stream',
			encrypted: false,
			pages: []
		}
	}
}
