// Deterministic static-site generator — the SSOT for the composer skill (board 0056 routing + 0057
// assembly). `buildSite` takes the GLM-maintained `src/` (plain-HTML components/layouts, i18n JSON,
// markdown pages/articles) and produces the EXACT Tigris key→object map used by BOTH the local
// preview and the remote deploy: per-locale pages assembled from layouts + markdown + i18n, a
// language switcher, a blog index, and the routing tail (slash-keys, /→/<locale>/, 404, sitemap,
// robots). `resolveRoute` mimics the edge+Tigris routing on the OUTPUT keys. Pure: no DOM/Storage.
import { marked } from 'marked'
import { assemble, i18nGet, type Strings } from './assemble'
import { parseFrontmatter } from './frontmatter'

export type SiteObject = { key: string; body: string; contentType: string }
export type SiteOptions = {
	/** Locales the site is published under. Default: inferred from src/i18n/<loc>.json (else ['en']). */
	locales?: string[]
	/** Locale the bare root redirects to (default: the first locale). */
	defaultLocale?: string
	/** Substituted for every `${BASE_URL}` token. Preview: '' (root-relative); deploy: the content host. */
	baseUrl?: string
}

const HTML = 'text/html; charset=utf-8'
const CSS = 'text/css; charset=utf-8'

/** Replace every `${BASE_URL}` token (plain string swap — no template-literal eval). */
const subst = (body: string, baseUrl: string): string =>
	// biome-ignore lint/suspicious/noTemplateCurlyInString: ${BASE_URL} is the literal placeholder token
	body.split('${BASE_URL}').join(baseUrl)

function redirectHtml(to: string): string {
	return (
		'<!doctype html><meta charset="utf-8">' +
		`<meta http-equiv="refresh" content="0; url=${to}">` +
		`<title>redirecting…</title><script>location.replace(${JSON.stringify(to)})</script>` +
		`<a href="${to}">→ ${to}</a>`
	)
}
function notFoundHtml(defaultLocale: string): string {
	return (
		'<!doctype html><meta charset="utf-8"><title>404</title>' +
		'<body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
		`<div><h1 style="font-size:4rem;margin:0">404</h1><p><a href="/${defaultLocale}/">→ home</a></p></div>`
	)
}

/** src/<dir>/<name>.<ext> → { name → content } for direct children only (components, layouts). */
function collect(src: Record<string, string>, prefix: string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [path, body] of Object.entries(src)) {
		if (!path.startsWith(prefix)) continue
		const rest = path.slice(prefix.length)
		if (rest.includes('/')) continue
		out[rest.replace(/\.[^.]+$/, '')] = body
	}
	return out
}

/** Locales present in a src tree (from src/i18n/<loc>.json), sorted. */
export function localesOf(src: Record<string, string>): string[] {
	const set = new Set<string>()
	for (const path of Object.keys(src)) {
		const m = path.match(/^src\/i18n\/([a-z]{2})\.json$/)
		if (m?.[1]) set.add(m[1])
	}
	return [...set].sort()
}

const renderMarkdown = (body: string): string => marked.parse(body, { async: false }) as string

/**
 * Assemble the deploy/preview key→object map from the `src/` tree. For each locale: render every
 * markdown page/article through its layout (resolving `{{> component}}` includes + `{{t.*}}` i18n +
 * `{{content}}`/`{{title}}`/… tokens), emit per-locale pages + slash-key aliases, generate the blog
 * index from the articles, and add the language switcher per page. Then the routing tail (404,
 * sitemap, robots, `/`→`/<default>/`). Deterministic: output is sorted by key.
 */
export function buildSite(src: Record<string, string>, opts: SiteOptions = {}): SiteObject[] {
	const detected = localesOf(src)
	const locales = opts.locales ?? (detected.length ? detected : ['en'])
	const defaultLocale = opts.defaultLocale ?? (locales.includes('en') ? 'en' : (locales[0] ?? 'en'))
	const baseUrl = opts.baseUrl ?? ''
	const partials = collect(src, 'src/components/')
	const layouts = collect(src, 'src/layouts/')
	const i18n: Record<string, Strings> = {}
	for (const loc of locales) {
		try {
			i18n[loc] = JSON.parse(src[`src/i18n/${loc}.json`] ?? '{}') as Strings
		} catch {
			i18n[loc] = {}
		}
	}

	const out = new Map<string, SiteObject>()
	const setKey = (rel: string, body: string): void => {
		out.set(rel, { key: rel, body, contentType: HTML })
		if (rel.endsWith('/index.html')) {
			const slash = rel.slice(0, -'index.html'.length) // slash-key alias (Tigris-direct)
			out.set(slash, { key: slash, body, contentType: HTML })
		}
	}

	// Language switcher for a logical path (e.g. /en/blog/foo/) — the same path in each locale.
	const switcher = (curLoc: string, path: string): string =>
		locales
			.map((loc) => {
				const lp = path.replace(new RegExp(`^/${curLoc}(/|$)`), `/${loc}$1`)
				const on = loc === curLoc ? ' class="on"' : ''
				return `<a href="${lp}"${on}>${loc.toUpperCase()}</a>`
			})
			.join(' ')

	const render = (mdSrc: string, loc: string, path: string): string => {
		const { data, body } = parseFrontmatter(mdSrc)
		const layout = layouts[data.layout ?? 'page'] ?? layouts.page ?? '{{content}}'
		const tokens = {
			lang: loc,
			path,
			title: data.title ?? '',
			date: data.date ?? '',
			summary: data.summary ?? '',
			content: renderMarkdown(body),
			lang_switcher: switcher(loc, path)
		}
		return subst(assemble(layout, { partials, i18n: i18n[loc], tokens }), baseUrl)
	}

	for (const loc of locales) {
		// pages: src/pages/<loc>/<name>.md → <loc>/index.html (home) | <loc>/<name>/index.html
		for (const [path, content] of Object.entries(src)) {
			const m = path.match(new RegExp(`^src/pages/${loc}/(.+)\\.md$`))
			if (!m?.[1]) continue
			const name = m[1]
			const rel = name === 'home' ? `${loc}/index.html` : `${loc}/${name}/index.html`
			const url = name === 'home' ? `/${loc}/` : `/${loc}/${name}/`
			setKey(rel, render(content, loc, url))
		}
		// blog articles: src/blog/<loc>/<slug>.md → <loc>/blog/<slug>/index.html
		const articles: { slug: string; title: string; summary: string; date: string }[] = []
		for (const [path, content] of Object.entries(src)) {
			const m = path.match(new RegExp(`^src/blog/${loc}/(.+)\\.md$`))
			if (!m?.[1]) continue
			const slug = m[1]
			const { data } = parseFrontmatter(content)
			articles.push({
				slug,
				title: data.title ?? slug,
				summary: data.summary ?? '',
				date: data.date ?? ''
			})
			setKey(`${loc}/blog/${slug}/index.html`, render(content, loc, `/${loc}/blog/${slug}/`))
		}
		// blog index (generated): heading + article cards (newest first), in the page layout
		const cards = articles
			.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
			.map((a) =>
				assemble(partials['article-card'] ?? '', {
					tokens: {
						url: `/${loc}/blog/${a.slug}/`,
						title: a.title,
						summary: a.summary,
						date: a.date
					}
				})
			)
			.join('\n')
		const blogTitle = i18nGet(i18n[loc] ?? {}, 'nav.blog') || 'Blog'
		const blogHtml = subst(
			assemble(layouts.page ?? '{{content}}', {
				partials,
				i18n: i18n[loc],
				tokens: {
					lang: loc,
					path: `/${loc}/blog/`,
					title: blogTitle,
					content: `<h1 class="section-title">${blogTitle}</h1><div class="blog-list">${cards}</div>`,
					lang_switcher: switcher(loc, `/${loc}/blog/`)
				}
			}),
			baseUrl
		)
		setKey(`${loc}/blog/index.html`, blogHtml)
	}

	// shared stylesheet + routing tail
	const styles = src['src/styles.css']
	if (styles) out.set('styles.css', { key: 'styles.css', body: styles, contentType: CSS })
	out.set('404.html', { key: '404.html', body: notFoundHtml(defaultLocale), contentType: HTML })
	out.set('index.html', {
		key: 'index.html',
		body: redirectHtml(`/${defaultLocale}/`),
		contentType: HTML
	})
	const urls = [...out.keys()].filter((k) => k.endsWith('/')).sort()
	out.set('sitemap.xml', {
		key: 'sitemap.xml',
		body:
			'<?xml version="1.0" encoding="UTF-8"?>' +
			'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
			urls.map((u) => `<url><loc>${baseUrl}/${u}</loc></url>`).join('') +
			'</urlset>',
		contentType: 'application/xml; charset=utf-8'
	})
	out.set('robots.txt', {
		key: 'robots.txt',
		body: 'User-agent: *\nAllow: /\n',
		contentType: 'text/plain; charset=utf-8'
	})
	return [...out.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** Edge+Tigris route resolution result. */
export type Resolution =
	| { status: 200; key: string }
	| { status: 301 | 302; location: string }
	| { status: 404; key: '404.html' }

/**
 * Mimic the edge + Tigris: resolve a request path to a 200 key, a redirect, or 404, using the key
 * set from `buildSite`. The preview's local router and the live edge agree because they read the
 * same keys. board 0056.
 */
export function resolveRoute(path: string, keys: Set<string>, opts: SiteOptions = {}): Resolution {
	const locales = opts.locales ?? ['en']
	const defaultLocale = opts.defaultLocale ?? (locales.includes('en') ? 'en' : (locales[0] ?? 'en'))
	let p = (path.split('?')[0] ?? '').split('#')[0] ?? ''
	if (!p.startsWith('/')) p = `/${p}`
	if (p === '/') return { status: 302, location: `/${defaultLocale}/` }
	const key = p.slice(1)
	if (keys.has(key)) return { status: 200, key } // slash-key / file — Tigris-direct
	if (locales.some((l) => p === `/${l}`)) return { status: 301, location: `${p}/` }
	if (!p.endsWith('/') && keys.has(`${key}/`)) return { status: 301, location: `${p}/` }
	if (p.endsWith('/') && keys.has(`${key}index.html`))
		return { status: 200, key: `${key}index.html` }
	return { status: 404, key: '404.html' }
}
