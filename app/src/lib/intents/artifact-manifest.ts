import { artifactTypeLabel } from '../artifacts/processing'

/**
 * The model's artifact awareness, sized for a system prompt.
 *
 * One line per recent file — name, kind, size, state, and at most one summary line —
 * so the model sees likely relevant attachments without reading any of them.
 * The details stay behind the artifact_detail tool: the model fetches one
 * file when it needs one, and only that file's summary and figures ride into
 * the context. Everything here is bounded by construction: a cap on lines,
 * a cap on summary length, no bytes, no stages, no payloads. artifact_list
 * can search the full metadata index when an older file is needed.
 */

/** One artifact of one intent, as the intent list knows it. */
export interface ArtifactManifestEntry {
	artifactId?: string
	title: string
	typeKey?: string
	/** Human type label ("PDF document", "Invoice"), when one is known. */
	label?: string
	note?: string
	/** Processing state, as last persisted (the live view wins when present). */
	state?: string
	summary?: string | null
}

/** What the live chat session knows about a committed artifact. */
export interface ArtifactLiveInfo {
	length?: number
	mediaType?: string
	label?: string
	state?: string
	summary?: string
}

export const MAX_MANIFEST_ENTRIES = 20
export const ARTIFACT_LOOKUP_LIMIT = 20
const MAX_SUMMARY_CHARS = 140

/** "512 B", "2 KB", "1.2 MB" — one human-readable size per line, never more. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return ''
	const units = ['B', 'KB', 'MB', 'GB', 'TB']
	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024
		unit++
	}
	const number =
		unit === 0
			? String(Math.round(value))
			: value.toLocaleString('de-DE', { maximumFractionDigits: 1 })
	return `${number} ${units[unit]}`
}

/** The short state word a model can build a sentence around. */
export function processingStateLabel(state: string | null | undefined): string {
	switch (state) {
		case 'active':
			return 'processing'
		case 'succeeded':
			return 'processing complete'
		case 'needs_review':
			return 'processing finished with a warning'
		case 'failed':
			return 'processing failed'
		default:
			return 'waiting for processing'
	}
}

function truncate(text: string, max: number): string {
	return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
}

/**
 * The compact block appended to the system context. Returns '' for no
 * artifacts, so an empty conversation costs the model nothing.
 *
 * `liveFor` answers "what does this session currently know about that id" —
 * the in-memory view from an upload or a processing watch; it wins over the
 * persisted `state`/`summary`, which is what makes the block true after a
 * restart before the watcher has caught up.
 */
export function artifactManifest(
	entries: ArtifactManifestEntry[],
	liveFor?: (artifactId: string) => ArtifactLiveInfo | undefined
): string {
	const lines: string[] = []
	for (const entry of entries.slice(-MAX_MANIFEST_ENTRIES).reverse()) {
		const live = entry.artifactId ? liveFor?.(entry.artifactId) : undefined
		// A live view, when present, is authoritative: it shadows the persisted
		// state and summary wholesale (a persisted summary is stale the moment
		// the processor is re-queried).
		const state = live ? live.state : entry.state
		const summary = live ? live.summary : (entry.summary ?? undefined)
		const size = live?.length ? formatBytes(live.length) : ''
		const kind = live?.label ?? entry.label ?? artifactTypeLabel(entry.typeKey ?? '')
		const stateText = state ? processingStateLabel(state) : (entry.note ?? 'attached')
		let line = `- ${entry.title} (${kind}${size ? `, ${size}` : ''}) — ${stateText}`
		if (summary) line += `: ${truncate(summary.trim(), MAX_SUMMARY_CHARS)}`
		lines.push(line)
	}
	if (lines.length === 0) return ''
	const hidden = entries.length - lines.length
	const more =
		hidden > 0
			? `\n…and ${hidden} older files; use workspace_search with kind document to search them`
			: ''
	return `ARTIFACTS in this conversation right now:\n${lines.join('\n')}${more}`
}

export interface ArtifactIndexEntry {
	intentId: string
	artifactId?: string
	title: string
	kind: string
	state?: string
	summary?: string | null
	note?: string
}

/** Bounded metadata search over files in all Intents, including archived ones. */
export function lookupArtifacts(
	entries: ArtifactIndexEntry[],
	query = '',
	offset = 0,
	limit = ARTIFACT_LOOKUP_LIMIT
): { rows: ArtifactIndexEntry[]; total: number; offset: number; hasMore: boolean } {
	const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
	const matches =
		terms.length === 0
			? entries
			: entries.filter((entry) => {
					const haystack =
						`${entry.intentId} ${entry.artifactId ?? ''} ${entry.title} ${entry.kind} ${entry.state ?? ''} ${entry.summary ?? ''} ${entry.note ?? ''}`.toLocaleLowerCase()
					return terms.every((term) => haystack.includes(term))
				})
	const start = Math.max(
		0,
		Math.min(matches.length, Math.floor(Number.isFinite(offset) ? offset : 0))
	)
	const count = Math.max(
		1,
		Math.min(
			ARTIFACT_LOOKUP_LIMIT,
			Math.floor(Number.isFinite(limit) ? limit : ARTIFACT_LOOKUP_LIMIT)
		)
	)
	return {
		rows: matches.slice(start, start + count),
		total: matches.length,
		offset: start,
		hasMore: start + count < matches.length
	}
}

/**
 * Match a model-supplied key against a list of artifacts: exact id first
 * (case-insensitive), then exact title, then a case-insensitive part of the
 * title. The same rule the intents use for their own lookups.
 */
export function resolveArtifact<T extends { artifactId?: string; title: string }>(
	artifacts: T[],
	key: string
): T | undefined {
	const k = key.trim().toLowerCase()
	if (k === '') return undefined
	return (
		artifacts.find((a) => a.artifactId?.toLowerCase() === k) ??
		artifacts.find((a) => a.title.toLowerCase() === k) ??
		artifacts.find((a) => a.title.toLowerCase().includes(k))
	)
}
