// Deterministic static-site generator — the routing SSOT for the composer skill. ONE function
// produces the EXACT Tigris key→object map that BOTH the local preview and the remote deploy use,
// so the preview routes identically to the deployed site (next.aven.ceo model: locale prefix,
// slash-keys + index.html fallbacks, /→/<locale>/ redirect, 404). Pure: no DOM/Storage.
//
// GLM authors only the SOURCE files (under public/) — content + a ${BASE_URL} placeholder — and
// this generator wires ALL routing. See README.md §2 "What the SSG must produce". board 0056.

export type SiteObject = { key: string; body: string; contentType: string }
export type SiteOptions = {
	/** Locales the site is published under (default ['en']). */
	locales?: string[]
	/** Locale the bare root redirects to (default 'en'). */
	defaultLocale?: string
	/** Substituted for every `${BASE_URL}` token in text bodies. Preview: the iframe origin; deploy:
	 *  the content host (https://www.next.aven.ceo). Default '' → root-relative. */
	baseUrl?: string
}

const HTML = 'text/html; charset=utf-8'
const MIME: Record<string, string> = {
	html: HTML,
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	mjs: 'text/javascript; charset=utf-8',
	json: 'application/json',
	svg: 'image/svg+xml',
	xml: 'application/xml',
	txt: 'text/plain; charset=utf-8',
	md: 'text/plain; charset=utf-8',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	ico: 'image/x-icon',
	woff: 'font/woff',
	woff2: 'font/woff2'
}
const TEXT_EXT = /\.(html|css|js|mjs|json|svg|xml|txt|md)$/i

function mimeFor(key: string): string {
	const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1).toLowerCase() : ''
	return MIME[ext] ?? 'application/octet-stream'
}

/** Replace every `${BASE_URL}` token (no template-literal eval — plain string swap). */
// biome-ignore lint/suspicious/noTemplateCurlyInString: ${BASE_URL} is the literal placeholder GLM writes, not interpolation
const subst = (body: string, baseUrl: string): string => body.split('${BASE_URL}').join(baseUrl)

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

/**
 * Build the deploy/preview key→object map from the composer's source files (a `public/…`→content
 * map). For each file: strip `public/` → its rel key. For any `…/index.html`, ALSO emit the
 * slash-key alias (the dir path) so `/<loc>/<dir>/` serves directly (Tigris-direct). Append
 * `404.html` and a root `index.html` redirect to `/<defaultLocale>/`. Text bodies get `${BASE_URL}`
 * substituted. Deterministic: output is sorted by key.
 */
export function buildSite(source: Record<string, string>, opts: SiteOptions = {}): SiteObject[] {
	const defaultLocale = opts.defaultLocale ?? 'en'
	const baseUrl = opts.baseUrl ?? ''
	const out = new Map<string, SiteObject>()
	for (const [path, raw] of Object.entries(source)) {
		if (!path.startsWith('public/')) continue
		const rel = path.slice('public/'.length)
		if (!rel) continue
		const body = TEXT_EXT.test(rel) ? subst(raw, baseUrl) : raw
		out.set(rel, { key: rel, body, contentType: mimeFor(rel) })
		// Slash-key alias for any directory index → `/<loc>/<dir>/` serves directly.
		if (rel.endsWith('/index.html')) {
			const slash = rel.slice(0, -'index.html'.length) // 'en/', 'en/blog/'
			out.set(slash, { key: slash, body, contentType: HTML })
		}
	}
	out.set('404.html', { key: '404.html', body: notFoundHtml(defaultLocale), contentType: HTML })
	out.set('index.html', {
		key: 'index.html',
		body: redirectHtml(`/${defaultLocale}/`),
		contentType: HTML
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
 * same keys. Rules (README §1/§2/§4):
 *   `/`              → 302 `/<default>/`            (language-negotiated bare apex)
 *   `/<loc>`         → 301 `/<loc>/`                (add the load-bearing trailing slash)
 *   exact key        → 200                          (slash-key `en/`, file `styles.css`, …)
 *   `/<dir>` w/ key  → 301 `/<dir>/`                (no-slash → slash)
 *   `/<dir>/`        → 200 `<dir>/index.html`       (index fallback)
 *   else             → 404 `404.html`
 */
export function resolveRoute(path: string, keys: Set<string>, opts: SiteOptions = {}): Resolution {
	const locales = opts.locales ?? ['en']
	const defaultLocale = opts.defaultLocale ?? 'en'
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
