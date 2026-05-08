/**
 * Markdown snapshot Maia sees each turn: every vault note as Path | Title so the model
 * can resolve entities before creating new files (see `.data/agents/maia/RULES.md`).
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
		'\n**Use this snapshot for entity resolution**: if a person or org already maps to one Path above, prefer **memory_edit** on **that** path — do not add another file for synonyms (Sam vs Samuel).\n'

	return md
}
