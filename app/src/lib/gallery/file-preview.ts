import type { FilesRow } from '@avenos/jazz-schema'

export function isPreviewableImage(mime: string): boolean {
	const m = mime.trim().toLowerCase()
	return m === 'image/svg+xml' || m.startsWith('image/')
}

export function isPdfMime(mime: string): boolean {
	return mime.trim().toLowerCase() === 'application/pdf'
}

export function imageDataUrl(row: FilesRow): string | null {
	if (!isPreviewableImage(row.mime_type)) return null
	const b64 = row.content_b64?.trim()
	if (!b64) return null
	return `data:${row.mime_type};base64,${b64}`
}

export function fileDownloadDataUrl(row: FilesRow): string | null {
	const b64 = row.content_b64?.trim()
	if (!b64) return null
	const mime = row.mime_type.trim() || 'application/octet-stream'
	return `data:${mime};base64,${b64}`
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
	return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
