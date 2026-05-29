/**
 * Gallery PDF preview: prefer native WebKit `<iframe>` / `<object>` with a blob URL (no worker),
 * fall back to rendering page 1 via pdf.js if the native path is unavailable.
 */

const PDFJS_DIST_VERSION = '5.7.284'

let workerConfigured = false

async function ensureWorker(module: typeof import('pdfjs-dist')): Promise<void> {
	if (workerConfigured) return
	const { default: workerUrlRel } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
	const href =
		typeof window !== 'undefined'
			? new URL(workerUrlRel, window.location.href).href
			: workerUrlRel
	module.GlobalWorkerOptions.workerSrc = href
	workerConfigured = true
}

/** Decode base64 (RFC 4648 + common URL-safe variants) into bytes; return null if invalid. */
export function decodeBase64ToBytes(b64: string): Uint8Array | null {
	const clean = b64.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
	if (!clean.length) return null
	const pad = (4 - (clean.length % 4)) % 4
	const padded = clean + '='.repeat(pad)
	try {
		const bin = atob(padded)
		const out = new Uint8Array(bin.length)
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
		return out
	} catch {
		return null
	}
}

function looksLikePdf(bytes: Uint8Array): boolean {
	if (bytes.length < 5) return false
	// %PDF-
	return (
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46 &&
		bytes[4] === 0x2d
	)
}

/** Optional: iframe/object can use this directly (no pdf.js). Caller must revokeObjectURL when done. */
export function createPdfObjectUrlFromBase64(base64: string): string | null {
	if (typeof URL === 'undefined' || typeof Blob === 'undefined') return null
	const bytes = decodeBase64ToBytes(base64.replace(/\s/g, '').trim())
	if (!bytes || !looksLikePdf(bytes)) return null
	const copy = new Uint8Array(bytes)
	const blob = new Blob([copy], { type: 'application/pdf' })
	return URL.createObjectURL(blob)
}

export async function renderPdfFirstPageDataUrl(
	base64: string,
	maxSide = 400,
): Promise<string | null> {
	if (typeof document === 'undefined') return null

	const clean = base64.replace(/\s/g, '').trim()
	if (!clean) return null

	const bytes = decodeBase64ToBytes(clean)
	if (!bytes || !looksLikePdf(bytes)) {
		console.warn('[gallery] PDF thumbnail: not valid base64 PDF payload (magic bytes)')
		return null
	}

	const pdfjs = await import('pdfjs-dist')
	const v = pdfjs.version ?? PDFJS_DIST_VERSION
	await ensureWorker(pdfjs)

	const data = bytes.slice()
	const wasmUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/wasm/`
	const loadingTask = pdfjs.getDocument({
		data,
		useWorkerFetch: false,
		cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/cmaps/`,
		cMapPacked: true,
		standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${v}/standard_fonts/`,
		wasmUrl,
	})

	try {
		const pdf = await loadingTask.promise
		const page = await pdf.getPage(1)
		const baseVp = page.getViewport({ scale: 1 })
		const scale = Math.min(maxSide / baseVp.width, maxSide / baseVp.height, 3)
		const viewport = page.getViewport({ scale })
		const canvas = document.createElement('canvas')
		const w = Math.max(1, Math.floor(viewport.width))
		const h = Math.max(1, Math.floor(viewport.height))
		canvas.width = w
		canvas.height = h
		const ctx = canvas.getContext('2d')
		if (!ctx) return null

		const task = page.render({
			canvasContext: ctx,
			viewport,
			canvas,
		})
		await task.promise
		return canvas.toDataURL('image/jpeg', 0.82)
	} catch (e) {
		console.warn('[gallery] PDF thumbnail (pdf.js) failed', e)
		return null
	} finally {
		try {
			await loadingTask.destroy()
		} catch {
			/* ignore */
		}
	}
}
