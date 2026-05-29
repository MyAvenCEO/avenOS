import type { JazzRow } from '$lib/jazz/api'

export function isPreviewableImage(mime: string): boolean {
	const m = mime.trim().toLowerCase()
	return m === 'image/svg+xml' || m.startsWith('image/')
}

export function isPdfMime(mime: string): boolean {
	return mime.trim().toLowerCase() === 'application/pdf'
}

export function imageDataUrl(row: JazzRow): string | null {
	const mime = String(row.mime_type ?? '')
	if (!isPreviewableImage(mime)) return null
	const b64 = String(row.content ?? '').trim()
	if (!b64) return null
	return `data:${mime};base64,${b64}`
}

export function fileDownloadDataUrl(row: JazzRow): string | null {
	const b64 = String(row.content ?? '').trim()
	if (!b64) return null
	const mime = String(row.mime_type ?? '').trim() || 'application/octet-stream'
	return `data:${mime};base64,${b64}`
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
