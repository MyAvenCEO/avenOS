import { type AvenContextPreview, buildAvenContextPreview } from '$lib/aven/context-preview'
import { maiaAgent } from '$lib/aven/maia-agent'
import { readMaiaRulesDoc } from '$lib/memory/maia-rules-md'
import { readSoulMarkdownBody } from '$lib/memory/soul-md'
import { ensureVaultDir, listVaultNotes } from '$lib/memory/vault'
import { buildVaultSnapshotPayload } from '$lib/memory/vault-snapshot-api'

export type AvenChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Builds the same system bundle + context preview the chat stream uses for `messages`.
 * Order: **SOUL** (`.data/agents/maia/SOUL.md`) → delimiter → **RULES** (`.data/agents/maia/RULES.md`)
 * → delimiter → **vault snapshot** (Markdown derived from vault scan; not persisted as a standalone file).
 */
export function buildAvenChatRoundContext(
	model: string,
	messages: AvenChatTurn[]
): { systemContent: string; preview: AvenContextPreview } {
	ensureVaultDir()
	const rules = readMaiaRulesDoc()
	const proceduralBody = rules.body
	const notes = listVaultNotes()
	const soulRaw = readSoulMarkdownBody().trimEnd()
	const snap = buildVaultSnapshotPayload(notes)
	const sb = maiaAgent.systemBundle
	const d = sb.delimiterMarkdown.trim()
	const systemContent = `${soulRaw}\n\n${d}\n\n${proceduralBody}\n\n${d}\n\n${snap.fullMarkdown}`
	const preview = buildAvenContextPreview({
		model,
		messages,
		soulChars: soulRaw.length,
		instructionChars: proceduralBody.length,
		fullSystemChars: systemContent.length
	})
	return { systemContent, preview }
}
