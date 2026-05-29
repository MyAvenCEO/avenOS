/**
 * Build-time catalog of Markdown chapters under libs/docs/self/founders/ and self/developers/.
 * Each group is independently ordered. Slugs within a group are filename-stems (e.g. `01-your-identity-on-device`).
 */

export type DocGroup = 'founders' | 'developers'

export type SelfDocMeta = {
	slug: string
	group: DocGroup
	/** Numeric prefix used for sort order */
	order: number
	title: string
	raw: string
}

// ---------------------------------------------------------------------------
// Raw glob imports (eager, ?raw)
// ---------------------------------------------------------------------------

const founderModules = import.meta.glob('@avenos/docs/self/founders/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>

const developerModules = import.meta.glob('@avenos/docs/self/developers/*.md', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

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

function buildMeta(path: string, raw: string, group: DocGroup): SelfDocMeta {
	const slug = slugFromPath(path)
	const { title: fmTitle, body } = parseFrontmatter(raw)
	const rest = slug.replace(/^\d{2}-/, '').replace(/-/g, ' ')
	const title = fmTitle ?? rest.charAt(0).toUpperCase() + rest.slice(1)
	return { slug, group, order: orderFromSlug(slug), title, raw: body.trim() }
}

function buildGroup(modules: Record<string, string>, group: DocGroup): SelfDocMeta[] {
	return Object.entries(modules)
		.filter(([path]) => DOC_KEY.test(path.split('/').pop() ?? ''))
		.map(([path, raw]) => buildMeta(path, raw as string, group))
		.sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const founderDocs: SelfDocMeta[] = buildGroup(founderModules, 'founders')
export const developerDocs: SelfDocMeta[] = buildGroup(developerModules, 'developers')

export const allSelfDocs: SelfDocMeta[] = [...founderDocs, ...developerDocs]

export const firstFounderSlug: string = founderDocs[0]?.slug ?? ''
export const firstDeveloperSlug: string = developerDocs[0]?.slug ?? ''

/** Look up a doc by group + slug. */
export function getSelfDoc(group: DocGroup, slug: string): SelfDocMeta | undefined {
	const list = group === 'founders' ? founderDocs : developerDocs
	return list.find((d) => d.slug === slug)
}
