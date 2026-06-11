/**
 * Markdown chapters under docs/identities/
 */
export type DocGroup = 'founders' | 'developers'

export type SparksDocMeta = {
	slug: string
	group: DocGroup
	order: number
	title: string
	raw: string
}

const founderModules = import.meta.glob('@avenos/docs/identities/founders/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>

const developerModules = import.meta.glob('@avenos/docs/identities/developers/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>

const DOC_KEY = /^\d{2}-.+\.md$/

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

function buildMeta(path: string, raw: string, group: DocGroup): SparksDocMeta {
	const slug = slugFromPath(path)
	const { title: fmTitle, body } = parseFrontmatter(raw)
	const rest = slug.replace(/^\d{2}-/, '').replace(/-/g, ' ')
	const title = fmTitle ?? rest.charAt(0).toUpperCase() + rest.slice(1)
	return { slug, group, order: orderFromSlug(slug), title, raw: body.trim() }
}

function buildGroup(modules: Record<string, string>, group: DocGroup): SparksDocMeta[] {
	return Object.entries(modules)
		.filter(([path]) => DOC_KEY.test(path.split('/').pop() ?? ''))
		.map(([path, raw]) => buildMeta(path, raw as string, group))
		.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

export const founderDocs: SparksDocMeta[] = buildGroup(founderModules, 'founders')
export const developerDocs: SparksDocMeta[] = buildGroup(developerModules, 'developers')
export const allSparksDocs: SparksDocMeta[] = [...founderDocs, ...developerDocs]

export const firstFounderSlug: string = founderDocs[0]?.slug ?? ''
export const firstDeveloperSlug: string = developerDocs[0]?.slug ?? ''

export function getSparksDoc(group: DocGroup, slug: string): SparksDocMeta | undefined {
	const list = group === 'founders' ? founderDocs : developerDocs
	return list.find((d) => d.slug === slug)
}
