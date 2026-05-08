/**
 * Obsidian-style `[[path]]` / `[[path|label]]` — shared by Memory HTML and vault link graph.
 * Fenced ``` blocks are skipped (same behavior as preview injection).
 */

/** Split markdown so odd indices are outside fenced code blocks. */
export function splitMarkdownSkipFencedCode(markdown: string): string[] {
	return markdown.split(/(```[\s\S]*?```)/g)
}

/** Match Obsidian-ish vault paths for targets in `[[…]]`. */
export function normalizeWikilinkPath(raw: string): string {
	const t = raw.trim()
	if (!t) return t
	return /\.md$/i.test(t) ? t.replace(/\\/g, '/') : `${t.replace(/\\/g, '/')}.md`
}

function posixBasename(p: string): string {
	const s = p.replace(/\\/g, '/')
	const i = s.lastIndexOf('/')
	return i === -1 ? s : s.slice(i + 1)
}

export type WikilinkResolution =
	| { status: 'resolved'; vaultPath: string }
	| { status: 'unresolved'; attempted: string }
	| { status: 'ambiguous'; attempted: string; matches: string[] }

/**
 * Resolve a wikilink to a vault-relative path.
 * 1) Exact path as written (e.g. `Humans/Samuel` or `Topics/X.md`).
 * 2) Otherwise unique basename match (`[[Samuel]]` → only `Humans/Samuel.md` if unique).
 * Matches Obsidian-style short links when filename is unique in the vault.
 */
export function resolveWikilinkToVaultPath(
	raw: string,
	allPaths: readonly string[]
): WikilinkResolution {
	const n = normalizeWikilinkPath(raw.trim())
	if (!n) return { status: 'unresolved', attempted: raw }

	const set = new Set(allPaths)
	if (set.has(n)) return { status: 'resolved', vaultPath: n }

	const exactBasename = (p: string): string => posixBasename(p)

	const caseMatches = (baseEq: (a: string, b: string) => boolean) =>
		allPaths.filter((p) => baseEq(exactBasename(p), n))

	let matches = caseMatches((a, b) => a === b)
	if (matches.length === 1) return { status: 'resolved', vaultPath: matches[0] }
	if (matches.length > 1) {
		return {
			status: 'ambiguous',
			attempted: n,
			matches: [...matches].sort((a, b) => a.localeCompare(b))
		}
	}

	const nLower = n.toLowerCase()
	matches = allPaths.filter((p) => exactBasename(p).toLowerCase() === nLower)
	if (matches.length === 1) return { status: 'resolved', vaultPath: matches[0] }
	if (matches.length > 1) {
		return {
			status: 'ambiguous',
			attempted: n,
			matches: [...matches].sort((a, b) => a.localeCompare(b))
		}
	}

	return { status: 'unresolved', attempted: n }
}

/** True for `[[Talk/m5]]`-style links (not vault paths; excluded from link graph). */
export function isTalkTurnWikilinkPath(raw: string): boolean {
	const t = raw.trim().replace(/\\/g, '/')
	return /^Talk\/m?\d+(?:\.md)?$/i.test(t)
}

type WikilinkEscapers = { escapeHtml: (s: string) => string; escapeAttr: (s: string) => string }

/** `[[Humans/Sam]]` / `[[Humans/Sam|Sam]]` → HTML spans (fenced ``` blocks untouched). */
export function injectWikilinkSpans(markdown: string, esc: WikilinkEscapers): string {
	const parts = splitMarkdownSkipFencedCode(markdown)
	return parts
		.map((chunk, i) => {
			if (i % 2 === 1) return chunk
			return chunk.replace(
				/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
				(_, pathRaw: string, labelRaw?: string) => {
					const pathTrim = pathRaw.trim().replace(/\\/g, '/')
					const talkM = /^Talk\/m?(\d+)(?:\.md)?$/i.exec(pathTrim)
					if (talkM) {
						const n = talkM[1]
						const label = String(labelRaw ?? `Talk m${n}`).trim()
						return `<span class="memory-talk-source cursor-pointer underline decoration-border/50" data-talk-turn="${esc.escapeAttr(n)}">${esc.escapeHtml(label)}</span>`
					}
					const path = pathRaw.trim()
					const label = String(labelRaw ?? path).trim()
					return `<span class="memory-wikilink" data-wikilink="${esc.escapeAttr(path)}">${esc.escapeHtml(label)}</span>`
				}
			)
		})
		.join('')
}

/**
 * Walk non-code chunks and invoke callback for each wikilink path (the part before `|`).
 */
export function forEachWikilinkPath(markdown: string, fn: (pathRaw: string) => void): void {
	const parts = splitMarkdownSkipFencedCode(markdown)
	for (let i = 0; i < parts.length; i += 2) {
		const chunk = parts[i]
		const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
		let m: RegExpExecArray | null
		while ((m = re.exec(chunk)) !== null) {
			const raw = m[1]?.trim()
			if (raw) fn(raw)
		}
	}
}
