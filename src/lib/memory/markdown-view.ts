import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'
import { bodyAfterFrontmatter } from './frontmatter'

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Match Obsidian-ish vault paths opened by Memory. */
export function normalizeWikilinkPath(raw: string): string {
	const t = raw.trim()
	if (!t) return t
	return /\.md$/i.test(t) ? t.replace(/\\/g, '/') : `${t.replace(/\\/g, '/')}.md`
}

/** `[[People/Sam]]` / `[[People/Sam|Sam]]` → clickable spans (fenced ``` blocks untouched). */
export function injectWikilinkSpans(markdown: string): string {
	const parts = markdown.split(/(```[\s\S]*?```)/g)
	return parts
		.map((chunk, i) => {
			if (i % 2 === 1) return chunk
			return chunk.replace(
				/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
				(_, pathRaw: string, labelRaw?: string) => {
					const path = pathRaw.trim()
					const label = String(labelRaw ?? path).trim()
					return `<span class="memory-wikilink" data-wikilink="${escapeAttr(path)}">${escapeHtml(label)}</span>`
				}
			)
		})
		.join('')
}

function parseMarkdownToHtml(markdown: string): string {
	const staged = injectWikilinkSpans(markdown)
	const unsafe = marked.parse(staged, { async: false, gfm: true }) as string
	return DOMPurify.sanitize(unsafe, {
		ALLOW_DATA_ATTR: true,
		ADD_TAGS: ['span'],
		ADD_ATTR: ['class', 'data-wikilink']
	})
}

export function renderVaultMarkdown(markdown: string): string {
	if (!markdown.trim()) return ''
	return parseMarkdownToHtml(bodyAfterFrontmatter(markdown))
}
