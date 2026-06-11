import type { AvenDbRow } from '$lib/avendb/api'

export function isPreviewableImage(mime: string): boolean {
	const m = mime.trim().toLowerCase()
	return m === 'image/svg+xml' || m.startsWith('image/')
}

export function isPdfMime(mime: string): boolean {
	return mime.trim().toLowerCase() === 'application/pdf'
}

/**
 * Short uppercase format label for a file row (e.g. "CSV", "JPEG", "PDF").
 * Prefers the filename extension, falls back to the mime subtype, then "FILE".
 * Used as the preview-tile fallback when no thumbnail can be rendered.
 */
export function fileTypeLabel(row: AvenDbRow): string {
	const name = String(row.filename ?? '').trim()
	const dot = name.lastIndexOf('.')
	if (dot >= 0 && dot < name.length - 1) {
		const ext = name.slice(dot + 1).trim()
		if (ext && ext.length <= 5 && /^[a-z0-9]+$/i.test(ext)) return ext.toUpperCase()
	}
	const mime = String(row.mime_type ?? '')
		.trim()
		.toLowerCase()
	if (mime) {
		const sub = mime.includes('/') ? mime.slice(mime.indexOf('/') + 1) : mime
		const cleaned = (sub.replace(/^x-/, '').replace(/\+.*$/, '').split('.').pop() ?? sub).trim()
		if (cleaned) return cleaned.toUpperCase()
	}
	return 'FILE'
}

export function imageDataUrl(row: AvenDbRow): string | null {
	const mime = String(row.mime_type ?? '')
	if (!isPreviewableImage(mime)) return null
	const b64 = String(row.content ?? '').trim()
	if (!b64) return null
	return `data:${mime};base64,${b64}`
}

export function fileDownloadDataUrl(row: AvenDbRow): string | null {
	const b64 = String(row.content ?? '').trim()
	if (!b64) return null
	const mime = String(row.mime_type ?? '').trim() || 'application/octet-stream'
	return `data:${mime};base64,${b64}`
}

/** IPC may expose manifest `exposeTs: bigint` fields as number or string. */
export function coerceEpochMs(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v
	if (typeof v === 'string' && v.trim()) {
		const n = Number(v.trim())
		if (Number.isFinite(n)) return n
	}
	return 0
}

export function coerceByteCount(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
	if (typeof v === 'string' && v.trim()) {
		const n = Number(v.trim())
		if (Number.isFinite(n) && n >= 0) return n
	}
	return 0
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
