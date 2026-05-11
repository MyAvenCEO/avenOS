/** Minimal YAML-ish front matter (key: value per line); no nesting. */
export type MarkdownFrontmatter = Record<string, string>

export type ParsedMarkdownDocument = {
	meta: MarkdownFrontmatter
	body: string
}

/**
 * Splits leading `---` … `---` block from Markdown. Unknown lines in the block are skipped.
 * Body is returned verbatim (may be empty).
 */
export function parseMarkdownFrontmatter(source: string): ParsedMarkdownDocument {
	const text = source.replace(/^\uFEFF/, '')
	if (!text.startsWith('---')) {
		return { meta: {}, body: text }
	}
	const firstNl = text.indexOf('\n', 3)
	if (firstNl === -1) return { meta: {}, body: text }

	let i = firstNl + 1
	const meta: MarkdownFrontmatter = {}
	while (i < text.length) {
		const lineEnd = text.indexOf('\n', i)
		const line = lineEnd === -1 ? text.slice(i).trimEnd() : text.slice(i, lineEnd).trimEnd()
		if (line === '---') {
			const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1
			return { meta, body: text.slice(bodyStart) }
		}
		const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
		if (kv) {
			let v = kv[2]?.trim() ?? ''
			if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
				v = v.slice(1, -1)
			}
			meta[kv[1]] = v
		}
		if (lineEnd === -1) break
		i = lineEnd + 1
	}
	return { meta, body: text }
}

/** Markdown body without an opening front matter fence (for titles / rendering). */
export function bodyAfterFrontmatter(source: string): string {
	return parseMarkdownFrontmatter(source).body
}
