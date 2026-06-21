// Minimal frontmatter parser — pulls a leading `--- … ---` block of `key: value` lines off a
// markdown document. Deliberately a tiny YAML SUBSET (flat string/number/date values, optional
// quotes) so the engine needs no YAML dependency and stays deterministic. board 0057.

export type Frontmatter = Record<string, string>

/** Split `--- … ---\n<body>` into the parsed key/value data + the remaining markdown body. */
export function parseFrontmatter(src: string): { data: Frontmatter; body: string } {
	const m = src.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/)
	if (!m) return { data: {}, body: src }
	const data: Frontmatter = {}
	for (const line of (m[1] ?? '').split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/)
		if (!kv) continue
		let v = (kv[2] ?? '').trim()
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1)
		}
		data[kv[1] as string] = v
	}
	return { data, body: m[2] ?? '' }
}
