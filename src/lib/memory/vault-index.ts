/**
 * Rowboat-equivalent idea: inject a searchable table of paths + titles each turn
 * (see `.repos/rowboat/apps/x/packages/core/src/knowledge/note_creation.ts` —
 * `# Knowledge Base Index` / resolve entities against pre-built index before creating files).
 */

export interface VaultNoteRow {
	path: string
	title: string
}

export function formatVaultSnapshotMarkdown(rows: VaultNoteRow[]): string {
	if (!rows.length) {
		return '_No notes yet. Use memory_write_file to create first files._'
	}

	let md = '| Path | Title |\n|------|-------|\n'
	for (const r of rows) {
		const p = r.path.replace(/\|/g, '\\|')
		const t = r.title.replace(/\|/g, '\\|').replace(/\n/g, ' ')
		md += `| ${p} | ${t} |\n`
	}
	md +=
		'\n**Use this snapshot for entity resolution** (same discipline as Rowboat’s `knowledge_index`). '
	md +=
		'If a logical person/org already maps to one Path above, prefer **memory_edit** on THAT path — do not add a second file for synonyms (Sam vs Samuel).\n'

	return md
}
