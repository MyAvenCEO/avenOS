/**
 * Markdown chapters under libs/docs/content/{overview,sheet,storytelling}/
 */
export const contentDocSections = ['overview', 'sheet', 'storytelling'] as const

export type ContentDocSection = (typeof contentDocSections)[number]

/** Default entry: intro with commercial hook. */
export const contentIntroHref = '/docs/content/overview/00-intro' as const

export type ContentDocMeta = {
	slug: string
	section: ContentDocSection
	order: number
	title: string
	raw: string
}

const DOC_KEY = /^\d{2}-.+\.md$/

const sectionModules: Record<ContentDocSection, Record<string, string>> = {
	overview: import.meta.glob('@avenos/docs/content/overview/*.md', {
		query: '?raw',
		import: 'default',
		eager: true,
	}) as Record<string, string>,
	sheet: import.meta.glob('@avenos/docs/content/sheet/*.md', {
		query: '?raw',
		import: 'default',
		eager: true,
	}) as Record<string, string>,
	storytelling: import.meta.glob('@avenos/docs/content/storytelling/*.md', {
		query: '?raw',
		import: 'default',
		eager: true,
	}) as Record<string, string>,
}

function parseFrontmatter(raw: string): { title?: string; body: string } {
	const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
	if (!m) return { body: raw }
	const fm = m[1]
	const body = m[2]
	let title: string | undefined
	for (const line of fm.split(/\r?\n/)) {
		const tm = line.match(/^\s*title:\s*(.+)\s*$/)
		if (tm) title = tm[1].replace(/^["']|["']$/g, '').trim()
	}
	return { title, body }
}

function slugFromPath(path: string): string {
	const base = path.split('/').pop() ?? ''
	return base.replace(/\.md$/, '')
}

function orderFromSlug(slug: string): number {
	const n = Number.parseInt(slug.slice(0, 2), 10)
	return Number.isFinite(n) ? n : 999
}

function buildMeta(path: string, raw: string, section: ContentDocSection): ContentDocMeta {
	const slug = slugFromPath(path)
	const { title: fmTitle, body } = parseFrontmatter(raw)
	const rest = slug.replace(/^\d{2}-/, '').replace(/-/g, ' ')
	const title = fmTitle ?? rest.charAt(0).toUpperCase() + rest.slice(1)
	return { slug, section, order: orderFromSlug(slug), title, raw: body.trim() }
}

function buildSection(modules: Record<string, string>, section: ContentDocSection): ContentDocMeta[] {
	return Object.entries(modules)
		.filter(([path]) => DOC_KEY.test(path.split('/').pop() ?? ''))
		.map(([path, raw]) => buildMeta(path, raw as string, section))
		.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

export const overviewDocs = buildSection(sectionModules.overview, 'overview')
export const sheetDocs = buildSection(sectionModules.sheet, 'sheet')
export const storytellingDocs = buildSection(sectionModules.storytelling, 'storytelling')

export const docsBySection: Record<ContentDocSection, ContentDocMeta[]> = {
	overview: overviewDocs,
	sheet: sheetDocs,
	storytelling: storytellingDocs,
}

export const allContentDocs: ContentDocMeta[] = contentDocSections.flatMap((s) => docsBySection[s])

export function isContentDocSection(value: string): value is ContentDocSection {
	return (contentDocSections as readonly string[]).includes(value)
}

export const firstContentDoc: { section: ContentDocSection; slug: string } | null = (() => {
	for (const section of contentDocSections) {
		const doc = docsBySection[section][0]
		if (doc) return { section, slug: doc.slug }
	}
	return null
})()

export function contentChapterHref(section: ContentDocSection, slug: string): string {
	return `/docs/content/${section}/${slug}`
}

export function getContentDoc(section: ContentDocSection, slug: string): ContentDocMeta | undefined {
	return docsBySection[section].find((d) => d.slug === slug)
}

/** @deprecated use isContentDocSection */
export const isContentDocGroup = isContentDocSection
