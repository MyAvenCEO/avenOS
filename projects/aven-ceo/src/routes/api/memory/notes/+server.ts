import { json } from '@sveltejs/kit'
import { ensureMaiaRulesFile } from '$lib/memory/maia-rules-md.js'
import { memoryVaultSnapshotMaiaAppendix } from '$lib/memory/memory-vault-maia-appendix.js'
import { ensureSoulMarkdownFile } from '$lib/memory/soul-md.js'
import { ensureVaultDir, listVaultNotes } from '$lib/memory/vault.js'
import { rebuildVaultGraph } from '$lib/memory/vault-graph.js'
import { buildVaultSnapshotPayload } from '$lib/memory/vault-snapshot-api.js'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
	try {
		ensureVaultDir()
		ensureSoulMarkdownFile()
		ensureMaiaRulesFile()
		const notes = listVaultNotes()
		rebuildVaultGraph()
		const snapshot = buildVaultSnapshotPayload(notes)
		const vaultMarkdown = snapshot.fullMarkdown + memoryVaultSnapshotMaiaAppendix()
		return json({
			ok: true as const,
			notes,
			vaultSnapshot: {
				generatedIso: snapshot.generatedIso,
				markdown: vaultMarkdown,
				tableMarkdownChars: snapshot.bodyMarkdown.length,
				noteCount: notes.length
			}
		})
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e)
		return json({ ok: false as const, error: message }, { status: 500 })
	}
}
