import {
	type AvenContextFull,
	type AvenContextPreview,
	buildAvenContextPreview
} from '$lib/aven/context-preview'
import { maiaAgent } from '$lib/aven/maia-agent'
import { memoryToolsOpenAI } from '$lib/memory/chat-tools-core'
import { readMaiaRulesDoc } from '$lib/memory/maia-rules-md'
import { buildOwnerContextMarkdown } from '$lib/memory/owner-context'
import { readSoulMarkdownBody } from '$lib/memory/soul-md'
import { ensureVaultDir, listVaultNotes } from '$lib/memory/vault'
import { formatVaultGraphSummaryMarkdown, loadVaultGraph } from '$lib/memory/vault-graph'
import { buildVaultSnapshotPayload } from '$lib/memory/vault-snapshot-api'

export type AvenChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * Builds the same system bundle + context preview the chat stream uses for `messages`.
 * Order: **SOUL** → **vault owner** (`Humans/OWNER_*.md`) → **RULES** → **vault snapshot** → **vault link graph summary** (derived `[[wikilinks]]` stats).
 */
export function buildAvenChatRoundContext(
	model: string,
	messages: AvenChatTurn[]
): { systemContent: string; preview: AvenContextPreview; fullContext: AvenContextFull } {
	ensureVaultDir()
	const rules = readMaiaRulesDoc()
	const proceduralBody = rules.body
	const notes = listVaultNotes()
	const soulRaw = readSoulMarkdownBody().trimEnd()
	const ownerMd = buildOwnerContextMarkdown()
	const snap = buildVaultSnapshotPayload(notes)
	const graphMd = formatVaultGraphSummaryMarkdown(loadVaultGraph())
	const sb = maiaAgent.systemBundle
	const d = sb.delimiterMarkdown.trim()
	const systemContent = `${soulRaw}\n\n${d}\n\n${ownerMd}\n\n${d}\n\n${proceduralBody}\n\n${d}\n\n${snap.fullMarkdown}\n\n${d}\n\n${graphMd}`

	let toolsSchemaJson: string
	try {
		toolsSchemaJson = JSON.stringify(memoryToolsOpenAI(), null, 2)
	} catch {
		toolsSchemaJson = '[]'
	}

	const fullContext: AvenContextFull = {
		soulMarkdown: soulRaw,
		ownerMarkdown: ownerMd,
		rulesMarkdown: proceduralBody,
		vaultSnapshotMarkdown: snap.fullMarkdown,
		vaultGraphMarkdown: graphMd,
		toolsSchemaJson,
		messages
	}

	const preview = buildAvenContextPreview({
		model,
		messages,
		soulChars: soulRaw.length,
		ownerChars: ownerMd.length,
		instructionChars: proceduralBody.length,
		vaultSnapshotChars: snap.fullMarkdown.length,
		vaultGraphChars: graphMd.length,
		fullSystemChars: systemContent.length
	})
	return { systemContent, preview, fullContext }
}
