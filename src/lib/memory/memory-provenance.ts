export const MEMORY_SOURCE_HEADING = '### Memory source'

/**
 * Appends an audit line linking this file version to the Talk turn (`mN`) or a manual save.
 * Idempotent per call: always adds one new bullet (causal chain over time).
 */
export function appendMemoryProvenance(
	fullMarkdown: string,
	source: { type: 'talk'; messageTurn: number } | { type: 'memory_ui' }
): string {
	const iso = new Date().toISOString()
	const line =
		source.type === 'talk'
			? `- \`${iso}\` — Source (Talk): [[Talk/m${source.messageTurn}|Talk m${source.messageTurn}]]`
			: `- \`${iso}\` — Source: Memory UI (manual save)`

	const trimmed = fullMarkdown.replace(/\s+$/u, '')
	if (trimmed.includes(MEMORY_SOURCE_HEADING)) {
		return `${trimmed}\n${line}\n`
	}
	return `${trimmed}\n\n---\n\n${MEMORY_SOURCE_HEADING}\n\n${line}\n`
}
