/**
 * Build hrefs from Maia agent manifest paths to workspace routes.
 */
const MAIA_MSG_JSON = '.data/agents/maia/messages/conversation.json'

export function memoryHrefForVaultPath(relativePath: string): string {
	const p = relativePath.trim()
	if (!p) return '/memory'
	return `/memory?path=${encodeURIComponent(p)}`
}

/** Conversation file → stay on Talk and jump to transcript panel. */
export function talkTranscriptHref(): string {
	return '/talk#ctx-transcript'
}

/** Resolve a bundled source path to Memory (vault file) or Talk (transcript). */
export function hrefForAgentSourcePath(relativePath: string): string {
	const p = relativePath.trim()
	if (p === MAIA_MSG_JSON) return talkTranscriptHref()
	return memoryHrefForVaultPath(p)
}
