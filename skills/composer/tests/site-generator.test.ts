// biome-ignore-all lint/suspicious/noTemplateCurlyInString: tests assert the literal ${BASE_URL} placeholder token
import { describe, expect, test } from 'bun:test'
import { buildSite, resolveRoute } from '../site-generator'

// A representative composer source: a home, a blog route (folder index), and the shared stylesheet.
// Note: it contains NONE of the routing artifacts (slash-keys, 404, redirect) — the generator must
// add those itself.
const SOURCE: Record<string, string> = {
	'public/en/index.html':
		'<!doctype html><html><head><link rel="stylesheet" href="/styles.css">' +
		'<link rel="canonical" href="${BASE_URL}/en/"></head><body>home</body></html>',
	'public/en/blog/index.html':
		'<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body>blog</body></html>',
	'public/styles.css': 'body{color:#000}'
}

describe('buildSite', () => {
	test('is deterministic (same input → identical output)', () => {
		expect(buildSite(SOURCE)).toEqual(buildSite(SOURCE))
	})

	test('owns routing: emits slash-key aliases, 404.html and the root redirect', () => {
		const keys = new Set(buildSite(SOURCE).map((o) => o.key))
		// the authored source files (minus public/)
		expect(keys.has('en/index.html')).toBe(true)
		expect(keys.has('en/blog/index.html')).toBe(true)
		expect(keys.has('styles.css')).toBe(true)
		// generator-added routing — present in OUTPUT though absent from SOURCE
		expect(keys.has('en/')).toBe(true) // slash-key alias for the home
		expect(keys.has('en/blog/')).toBe(true) // slash-key alias for the blog
		expect(keys.has('404.html')).toBe(true)
		expect(keys.has('index.html')).toBe(true) // root → /en/ redirect
		// and the source contained none of those
		const srcKeys = Object.keys(SOURCE).map((p) => p.replace(/^public\//, ''))
		expect(srcKeys).not.toContain('en/')
		expect(srcKeys).not.toContain('404.html')
	})

	test('substitutes ${BASE_URL} from opts.baseUrl', () => {
		const objs = buildSite(SOURCE, { baseUrl: 'https://www.next.aven.ceo' })
		const home = objs.find((o) => o.key === 'en/index.html')
		expect(home?.body).toContain('href="https://www.next.aven.ceo/en/"')
		expect(home?.body).not.toContain('${BASE_URL}')
		// default baseUrl '' → token simply removed (root-relative)
		const homeDefault = buildSite(SOURCE).find((o) => o.key === 'en/index.html')
		expect(homeDefault?.body).toContain('href="/en/"')
	})

	test('slash-key alias shares the home body + html content-type', () => {
		const objs = buildSite(SOURCE)
		const slash = objs.find((o) => o.key === 'en/')
		const idx = objs.find((o) => o.key === 'en/index.html')
		expect(slash?.body).toBe(idx?.body)
		expect(slash?.contentType).toContain('text/html')
	})
})

describe('resolveRoute', () => {
	const keys = new Set(buildSite(SOURCE).map((o) => o.key))
	const R = (p: string) => resolveRoute(p, keys)

	test('/ → 302 /en/', () => {
		expect(R('/')).toEqual({ status: 302, location: '/en/' })
	})
	test('/en → 301 /en/', () => {
		expect(R('/en')).toEqual({ status: 301, location: '/en/' })
	})
	test('/en/ → 200 (slash-key)', () => {
		expect(R('/en/')).toEqual({ status: 200, key: 'en/' })
	})
	test('/en/blog/ → 200 (slash-key)', () => {
		expect(R('/en/blog/')).toEqual({ status: 200, key: 'en/blog/' })
	})
	test('/en/blog → 301 /en/blog/ (add slash)', () => {
		expect(R('/en/blog')).toEqual({ status: 301, location: '/en/blog/' })
	})
	test('/styles.css → 200', () => {
		expect(R('/styles.css')).toEqual({ status: 200, key: 'styles.css' })
	})
	test('/nope → 404', () => {
		expect(R('/nope')).toEqual({ status: 404, key: '404.html' })
	})
})
