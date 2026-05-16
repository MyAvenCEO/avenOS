import DOMPurify from 'dompurify'
import GithubSlugger from 'github-slugger'
import { Marked } from 'marked'
import type { Tokens } from 'marked'

export type TocItem = {
	id: string
	text: string
	level: number
}

/**
 * Render GitHub-flavoured markdown to sanitized HTML and extract H2/H3 anchors for TOC.
 */
export function renderDocMarkdown(markdown: string): { html: string; toc: TocItem[] } {
	const slugger = new GithubSlugger()
	const toc: TocItem[] = []

	const md = new Marked({ async: false, gfm: true })
	md.use({
		renderer: {
			heading(
				this: { parser: { parseInline: (t: Tokens.Generic[]) => string } },
				{ tokens, depth, text }: Tokens.Heading,
			) {
				const inner = this.parser.parseInline(tokens)
				if (depth === 1 || depth === 2 || depth === 3) {
					const label = text.trim()
					const id = slugger.slug(label)
					toc.push({ id, text: label, level: depth })
					return `<h${depth} id="${id}">${inner}</h${depth}>\n`
				}
				return `<h${depth}>${inner}</h${depth}>\n`
			},
		},
	})

	const rawHtml = md.parse(markdown, { async: false }) as string
	const html = DOMPurify.sanitize(rawHtml, {
		ADD_ATTR: ['id'],
	})
	return { html, toc }
}
