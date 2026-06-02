/** Parsed YAML-ish frontmatter — only the scalar/array shapes the board needs. */
export type Frontmatter = {
	fields: Record<string, string>
	tags: string[]
	body: string
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

function stripQuotes(value: string): string {
	return value.replace(/^["']|["']$/g, '').trim()
}

/** Parse an inline `[a, b, c]` array or a comma-separated scalar list into trimmed entries. */
function parseList(value: string): string[] {
	const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '')
	if (inner.trim() === '') return []
	return inner
		.split(',')
		.map((part) => stripQuotes(part))
		.filter((part) => part.length > 0)
}

/**
 * Split a markdown document into frontmatter fields and body.
 * Supports `key: value` scalars and inline `tags: [a, b]` arrays. No nested objects.
 */
export function parseFrontmatter(raw: string): Frontmatter {
	const match = raw.match(FRONTMATTER)
	if (!match) return { fields: {}, tags: [], body: raw }

	const [, head, body] = match
	const fields: Record<string, string> = {}
	let tags: string[] = []

	for (const line of head.split(/\r?\n/)) {
		const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/)
		if (!m) continue
		const key = m[1].trim()
		const value = m[2].trim()
		if (key === 'tags') {
			tags = parseList(value)
			continue
		}
		fields[key] = stripQuotes(value)
	}

	return { fields, tags, body }
}
