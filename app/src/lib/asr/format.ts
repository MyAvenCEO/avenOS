/** Byte formatting for the voice-model download UI. Pure + unit-testable. */

/** Human-readable byte size, e.g. `312 MB`, `4.1 GB`. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
	const mb = bytes / (1024 * 1024)
	if (mb < 1024) return `${Math.round(mb)} MB`
	return `${(mb / 1024).toFixed(1)} GB`
}

/** `received / total` pair, e.g. `312 MB / 4.1 GB`; omits the total when unknown. */
export function formatBytesPair(received: number, total: number): string {
	if (total > 0) return `${formatBytes(received)} / ${formatBytes(total)}`
	return formatBytes(received)
}
