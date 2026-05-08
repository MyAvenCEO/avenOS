import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'
import { bodyAfterFrontmatter } from './frontmatter'
import {
	injectWikilinkSpans as injectWikilinkSpansImpl,
	normalizeWikilinkPath,
	resolveWikilinkToVaultPath
} from './wikilink-parse'

export { normalizeWikilinkPath, resolveWikilinkToVaultPath }

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** `[[Humans/Sam]]` / `[[Humans/Sam|Sam]]` → clickable spans (fenced ``` blocks untouched). */
export function injectWikilinkSpans(markdown: string): string {
	return injectWikilinkSpansImpl(markdown, { escapeHtml, escapeAttr })
}

function parseMarkdownToHtml(markdown: string): string {
	const staged = injectWikilinkSpans(markdown)
	const unsafe = marked.parse(staged, { async: false, gfm: true }) as string
	return DOMPurify.sanitize(unsafe, {
		ALLOW_DATA_ATTR: true,
		ADD_TAGS: ['span'],
		ADD_ATTR: ['class', 'data-wikilink', 'data-talk-turn']
	})
}

export function renderVaultMarkdown(markdown: string): string {
	if (!markdown.trim()) return ''
	return parseMarkdownToHtml(bodyAfterFrontmatter(markdown))
}
