/**
 * Serialize the live vault index (same Markdown Maia receives under "Vault snapshot").
 * Not stored on disk; derived by scanning all `.md` files under `.data/knowledge` recursively.
 */

import { maiaAgent } from '$lib/aven/maia-agent'
import type { VaultNoteRow } from '$lib/memory/vault-index'
import { formatVaultSnapshotMarkdown } from '$lib/memory/vault-index'

export type VaultSnapshotPayload = {
	generatedIso: string
	headlineMarkdown: string
	bodyMarkdown: string
	fullMarkdown: string
}

export function buildVaultSnapshotPayload(rows: VaultNoteRow[]): VaultSnapshotPayload {
	const generatedIso = new Date().toISOString()
	const headlineMarkdown = maiaAgent.systemBundle.snapshotHeadingMarkdownTemplate.replace(
		'{iso}',
		generatedIso
	)
	const bodyMarkdown = formatVaultSnapshotMarkdown(rows)
	const fullMarkdown = `${headlineMarkdown}\n\n${bodyMarkdown}`
	return { generatedIso, headlineMarkdown, bodyMarkdown, fullMarkdown }
}
