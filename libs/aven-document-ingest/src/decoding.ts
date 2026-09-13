import { decodeCsvText, isCsvSource } from './csv'
import type {
	DecodedDocument,
	DecodedPage,
	DecodedTextRun,
	DocumentDecodeOptions,
	DocumentSource
} from './shared'
export const MAX_FILE_BYTES = 128 * 1024 * 1024
export const MAX_RENDER_BYTES = 12 * 1024 * 1024
export const MAX_DECODED_BYTES = 24 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
const MILLION = 1_000_000
export function base64Length(base64: string): number {
	return (
		Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
	)
}
export function isPdf(bytes: Uint8Array): boolean {
	for (let i = 0; i < Math.min(1024, bytes.length - 4); i++)
		if (hasPrefix(bytes.subarray(i), [37, 80, 68, 70, 45])) return true
	return false
}
/** Each page has its own rendering budget, independent of document length. */
export function renderScale(width: number, height: number, _pages: number): number {
	const pixels = 4_000_000
	return Math.min(2, Math.sqrt(pixels / (width * height)))
}
export function boundedDocument(document: DecodedDocument): DecodedDocument {
	const size = () => new TextEncoder().encode(JSON.stringify(document)).byteLength
	const imageBytes = document.pages.reduce(
		(sum, page) => sum + (page.image ? base64Length(page.image.base64) : 0),
		0
	)
	if (imageBytes > MAX_RENDER_BYTES || size() > MAX_DECODED_BYTES)
		for (const page of document.pages) delete page.image
	if (size() > MAX_DECODED_BYTES)
		return {
			outcome: 'unsupported',
			detectedMediaType: document.detectedMediaType,
			encrypted: false,
			pages: []
		}
	return document
}
export function pngDimensions(bytes: Uint8Array): [number, number] | null {
	if (!hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || bytes.length < 24)
		return null
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const width = view.getUint32(16)
	const height = view.getUint32(20)
	return width > 0 && height > 0 ? [width, height] : null
}

export function jpegDimensions(bytes: Uint8Array): [number, number] | null {
	if (!hasPrefix(bytes, [0xff, 0xd8])) return null
	let offset = 2
	while (offset + 3 < bytes.length) {
		if (bytes[offset] !== 0xff) {
			offset += 1
			continue
		}
		while (bytes[offset] === 0xff) offset += 1
		const marker = bytes[offset++]
		if (marker === undefined || marker === 0xd9 || marker === 0xda) break
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
		if (offset + 1 >= bytes.length) return null
		const length = (bytes[offset] ?? 0) * 256 + (bytes[offset + 1] ?? 0)
		if (length < 2 || offset + length > bytes.length) return null
		const startOfFrame =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf)
		if (startOfFrame && length >= 7) {
			const height = (bytes[offset + 3] ?? 0) * 256 + (bytes[offset + 4] ?? 0)
			const width = (bytes[offset + 5] ?? 0) * 256 + (bytes[offset + 6] ?? 0)
			return width > 0 && height > 0 ? [width, height] : null
		}
		offset += length
	}
	return null
}

export function jpegVisualBytes(bytes: Uint8Array): Uint8Array | null {
	if (!hasPrefix(bytes, [0xff, 0xd8])) return null
	let offset = 2
	let scan = false
	while (offset < bytes.length) {
		if (bytes[offset++] !== 0xff) {
			if (scan) continue
			return null
		}
		while (bytes[offset] === 0xff) offset++
		const marker = bytes[offset++]
		if (marker === undefined) return null
		if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue
		if (marker === 0xd9) return bytes.slice(0, offset)
		if (marker === 0x01) continue
		if (offset + 1 >= bytes.length) return null
		const length = bytes[offset]! * 256 + bytes[offset + 1]!
		if (length < 2 || offset + length > bytes.length) return null
		offset += length
		scan = marker === 0xda
	}
	return null
}

export function boundedImage(width: number, height: number): boolean {
	return width * height <= MAX_IMAGE_PIXELS
}

export function boundedBase64(base64: string): string {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
	const length = Math.floor((base64.length * 3) / 4) - padding
	if (length > MAX_RENDER_BYTES) throw new Error('rendered model page exceeds 12 MiB')
	return base64
}

export function normalizedRun(
	item: unknown,
	viewport: { width: number; height: number; transform: number[] }
): DecodedTextRun | null {
	const value = item as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown }
	if (!value || typeof value.str !== 'string' || !Array.isArray(value.transform)) return null
	const t = value.transform.map(Number)
	if (t.length !== 6 || !t.every(Number.isFinite)) return null
	const width = Math.abs(Number(value.width ?? 0)),
		height = Math.abs(Number(value.height ?? 0))
	const horizontal = Math.hypot(t[0]!, t[1]!) || 1,
		vertical = Math.hypot(t[2]!, t[3]!) || 1
	const matrix = viewport.transform
	const points = [
		[0, 0],
		[width, 0],
		[0, height],
		[width, height]
	].map(([x, y]) => {
		const px = t[4]! + (x! * t[0]!) / horizontal + (y! * t[2]!) / vertical
		const py = t[5]! + (x! * t[1]!) / horizontal + (y! * t[3]!) / vertical
		return [
			matrix[0]! * px + matrix[2]! * py + matrix[4]!,
			matrix[1]! * px + matrix[3]! * py + matrix[5]!
		]
	})
	const xs = points.map((p) => p[0]!),
		ys = points.map((p) => p[1]!)
	const x = normalized(Math.min(...xs), viewport.width),
		y = normalized(Math.min(...ys), viewport.height)
	return {
		text: value.str,
		x,
		y,
		width: Math.min(MILLION - x, normalized(Math.max(...xs) - Math.min(...xs), viewport.width)),
		height: Math.min(MILLION - y, normalized(Math.max(...ys) - Math.min(...ys), viewport.height))
	}
}

export function normalized(value: number, extent: number): number {
	if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) return 0
	return Math.max(0, Math.min(MILLION, Math.round((value / extent) * MILLION)))
}

export function normalizeRotation(value: number): DecodedPage['rotation'] {
	const normalized = ((Math.round(value) % 360) + 360) % 360
	return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

export function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
	return prefix.every((byte, index) => bytes[index] === byte)
}

export function decodePlainText(
	source: DocumentSource,
	bytes: Uint8Array,
	options?: DocumentDecodeOptions
): DecodedDocument | null {
	const textLike =
		source.declaredMediaType.toLowerCase().split(';', 1)[0]?.startsWith('text/') ||
		/\.(?:txt|md|csv)$/i.test(source.originalName)
	if (!textLike && !isCsvSource(source)) return null
	if (options?.textRange && options.pageRange && !isCsvSource(source)) {
		const { start, endExclusive } = options.textRange
		if (
			!Number.isSafeInteger(start) ||
			!Number.isSafeInteger(endExclusive) ||
			start < 0 ||
			endExclusive < start ||
			endExclusive > bytes.length
		)
			throw new Error('Invalid text chunk byte range')
		const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
			bytes.subarray(start, endExclusive)
		)
		return {
			outcome: 'ok',
			detectedMediaType: 'text/plain',
			encrypted: false,
			pages: [
				{
					page: options.pageRange.start,
					rotation: 0,
					width: 1,
					height: 1,
					textRange: { start, endExclusive },
					runs: [{ text, x: 0, y: 0, width: MILLION, height: MILLION }]
				}
			]
		}
	}
	let text: string
	try {
		text = isCsvSource(source)
			? decodeCsvText(bytes)
			: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
	} catch {
		return { outcome: 'malformed', detectedMediaType: 'text/plain', encrypted: false, pages: [] }
	}
	if (text.includes('\0'))
		return { outcome: 'malformed', detectedMediaType: 'text/plain', encrypted: false, pages: [] }
	const encoded = new TextEncoder().encode(text)
	const pages: DecodedPage[] = []
	// UTF-8 boundaries and newlines are preserved exactly, including repeated rows.
	for (let start = 0; start < encoded.length || (start === 0 && encoded.length === 0); ) {
		let end = Math.min(encoded.length, start + 16_000)
		while (end < encoded.length && (encoded[end]! & 0xc0) === 0x80) end--
		if (end < encoded.length) {
			let newline = end - 1
			while (newline > start + 8_000 && encoded[newline] !== 10) newline--
			if (encoded[newline] === 10) end = newline + 1
		}
		const page = pages.length + 1
		pages.push({
			page,
			rotation: 0,
			width: 1,
			height: 1,
			...(!isCsvSource(source) && { textRange: { start, endExclusive: end } }),
			...(options?.metadataOnly
				? { deferred: true, runs: [] }
				: {
						runs: [
							{
								text: new TextDecoder().decode(encoded.subarray(start, end)),
								x: 0,
								y: 0,
								width: MILLION,
								height: MILLION
							}
						]
					})
		})
		if (end === encoded.length) break
		start = end
	}
	const range = options?.pageRange
	return {
		outcome: 'ok',
		detectedMediaType: 'text/plain',
		encrypted: false,
		pages: range ? pages.slice(range.start - 1, range.start - 1 + range.count) : pages
	}
}
