//#region src/lib/memory/frontmatter.ts
/**
* Splits leading `---` … `---` block from Markdown. Unknown lines in the block are skipped.
* Body is returned verbatim (may be empty).
*/
function parseMarkdownFrontmatter(source) {
	const text = source.replace(/^\uFEFF/, "");
	if (!text.startsWith("---")) return {
		meta: {},
		body: text
	};
	const firstNl = text.indexOf("\n", 3);
	if (firstNl === -1) return {
		meta: {},
		body: text
	};
	let i = firstNl + 1;
	const meta = {};
	while (i < text.length) {
		const lineEnd = text.indexOf("\n", i);
		const line = lineEnd === -1 ? text.slice(i).trimEnd() : text.slice(i, lineEnd).trimEnd();
		if (line === "---") {
			const bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
			return {
				meta,
				body: text.slice(bodyStart)
			};
		}
		const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
		if (kv) {
			let v = kv[2]?.trim() ?? "";
			if (v.startsWith("\"") && v.endsWith("\"") || v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
			meta[kv[1]] = v;
		}
		if (lineEnd === -1) break;
		i = lineEnd + 1;
	}
	return {
		meta,
		body: text
	};
}
/** Markdown body without an opening front matter fence (for titles / rendering). */
function bodyAfterFrontmatter(source) {
	return parseMarkdownFrontmatter(source).body;
}
//#endregion
//#region src/lib/memory/wikilink-parse.ts
/**
* Obsidian-style `[[path]]` / `[[path|label]]` — shared by Memory HTML and vault link graph.
* Fenced ``` blocks are skipped (same behavior as preview injection).
*/
/** Split markdown so odd indices are outside fenced code blocks. */
function splitMarkdownSkipFencedCode(markdown) {
	return markdown.split(/(```[\s\S]*?```)/g);
}
/** Match Obsidian-ish vault paths for targets in `[[…]]`. */
function normalizeWikilinkPath(raw) {
	const t = raw.trim();
	if (!t) return t;
	return /\.md$/i.test(t) ? t.replace(/\\/g, "/") : `${t.replace(/\\/g, "/")}.md`;
}
function posixBasename(p) {
	const s = p.replace(/\\/g, "/");
	const i = s.lastIndexOf("/");
	return i === -1 ? s : s.slice(i + 1);
}
/**
* Resolve a wikilink to a vault-relative path.
* 1) Exact path as written (e.g. `Humans/Samuel` or `Concepts/X.md`).
* 2) Otherwise unique basename match (`[[Samuel]]` → only `Humans/Samuel.md` if unique).
* Matches Obsidian-style short links when filename is unique in the vault.
*/
function resolveWikilinkToVaultPath(raw, allPaths) {
	const n = normalizeWikilinkPath(raw.trim());
	if (!n) return {
		status: "unresolved",
		attempted: raw
	};
	if (new Set(allPaths).has(n)) return {
		status: "resolved",
		vaultPath: n
	};
	const exactBasename = (p) => posixBasename(p);
	const caseMatches = (baseEq) => allPaths.filter((p) => baseEq(exactBasename(p), n));
	let matches = caseMatches((a, b) => a === b);
	if (matches.length === 1) return {
		status: "resolved",
		vaultPath: matches[0]
	};
	if (matches.length > 1) return {
		status: "ambiguous",
		attempted: n,
		matches: [...matches].sort((a, b) => a.localeCompare(b))
	};
	const nLower = n.toLowerCase();
	matches = allPaths.filter((p) => exactBasename(p).toLowerCase() === nLower);
	if (matches.length === 1) return {
		status: "resolved",
		vaultPath: matches[0]
	};
	if (matches.length > 1) return {
		status: "ambiguous",
		attempted: n,
		matches: [...matches].sort((a, b) => a.localeCompare(b))
	};
	return {
		status: "unresolved",
		attempted: n
	};
}
/** True for `[[Talk/m5]]`-style links (not vault paths; excluded from link graph). */
function isTalkTurnWikilinkPath(raw) {
	const t = raw.trim().replace(/\\/g, "/");
	return /^Talk\/m?\d+(?:\.md)?$/i.test(t);
}
/** `[[Humans/Sam]]` / `[[Humans/Sam|Sam]]` → HTML spans (fenced ``` blocks untouched). */
function injectWikilinkSpans(markdown, esc) {
	return splitMarkdownSkipFencedCode(markdown).map((chunk, i) => {
		if (i % 2 === 1) return chunk;
		return chunk.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, pathRaw, labelRaw) => {
			const pathTrim = pathRaw.trim().replace(/\\/g, "/");
			const talkM = /^Talk\/m?(\d+)(?:\.md)?$/i.exec(pathTrim);
			if (talkM) {
				const n = talkM[1];
				const label = String(labelRaw ?? `Talk m${n}`).trim();
				return `<span class="memory-talk-source cursor-pointer underline decoration-border/50" data-talk-turn="${esc.escapeAttr(n)}">${esc.escapeHtml(label)}</span>`;
			}
			const path = pathRaw.trim();
			const label = String(labelRaw ?? path).trim();
			return `<span class="memory-wikilink" data-wikilink="${esc.escapeAttr(path)}">${esc.escapeHtml(label)}</span>`;
		});
	}).join("");
}
/**
* Walk non-code chunks and invoke callback for each wikilink path (the part before `|`).
*/
function forEachWikilinkPath(markdown, fn) {
	const parts = splitMarkdownSkipFencedCode(markdown);
	for (let i = 0; i < parts.length; i += 2) {
		const chunk = parts[i];
		const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
		for (;;) {
			const m = re.exec(chunk);
			if (m === null) break;
			const raw = m[1]?.trim();
			if (raw) fn(raw);
		}
	}
}
//#endregion
export { resolveWikilinkToVaultPath as a, normalizeWikilinkPath as i, injectWikilinkSpans as n, bodyAfterFrontmatter as o, isTalkTurnWikilinkPath as r, parseMarkdownFrontmatter as s, forEachWikilinkPath as t };
