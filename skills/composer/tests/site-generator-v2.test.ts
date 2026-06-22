// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions reference the literal ${BASE_URL} token
import { describe, expect, test } from 'bun:test'
import { SEED_SRC } from '../seed'
import { buildSite, localesOf, resolveRoute } from '../site-generator'

const objs = buildSite(SEED_SRC)
const keys = new Set(objs.map((o) => o.key))
const body = (k: string): string => objs.find((o) => o.key === k)?.body ?? ''
const R = (p: string) => resolveRoute(p, keys, { locales: ['en', 'de'], defaultLocale: 'en' })

describe('buildSite v2 (src -> public assembly)', () => {
	test('is deterministic', () => {
		expect(buildSite(SEED_SRC)).toEqual(buildSite(SEED_SRC))
	})

	test('detects locales from src/i18n', () => {
		expect(localesOf(SEED_SRC)).toEqual(['de', 'en'])
	})

	test('emits per-locale pages + slash-key aliases + routing tail', () => {
		for (const k of [
			'en/index.html',
			'en/',
			'de/index.html',
			'de/',
			'en/blog/index.html',
			'en/blog/',
			'en/blog/founders-compass/index.html',
			'en/blog/founders-compass/',
			'de/blog/founders-compass/index.html',
			'styles.css',
			'index.html',
			'404.html',
			'sitemap.xml'
		]) {
			expect(keys.has(k)).toBe(true)
		}
	})

	test('home (EN) assembles the nav include + i18n labels + rendered markdown + switcher', () => {
		const en = body('en/index.html')
		expect(en).toContain('class="top-nav"') // nav component was included
		expect(en).toContain('>Home<') // en i18n nav.home
		expect(en).toContain('>Blog<') // en i18n nav.blog
		expect(en).toContain('A calm, hand-crafted home') // rendered hero (tagline)
		expect(en).toContain('assembled by the composer') // rendered markdown body (lede)
		expect(en).toContain('href="/de/"') // language switcher -> other locale
	})

	test('home (DE) uses DE labels + an EN switcher link', () => {
		const de = body('de/index.html')
		expect(de).toContain('>Start<') // de i18n nav.home
		expect(de).toContain('handgemachtes') // de rendered hero text
		expect(de).toContain('href="/en/"') // switcher -> en
	})

	test('article page has its frontmatter title + rendered markdown in the article layout', () => {
		const a = body('en/blog/founders-compass/index.html')
		expect(a).toContain("The Founder's Compass") // frontmatter title
		expect(a).toContain('still points home') // rendered markdown body
		expect(a).toContain('<article>') // article layout
	})

	test('blog index lists the article via the article-card component', () => {
		const idx = body('en/blog/index.html')
		expect(idx).toContain('blog-card')
		expect(idx).toContain("The Founder's Compass")
		expect(idx).toContain('href="/en/blog/founders-compass/"')
	})

	test('substitutes ${BASE_URL} with the deploy host', () => {
		const o = buildSite(SEED_SRC, { baseUrl: 'https://www.next.aven.ceo' })
		const en = o.find((x) => x.key === 'en/index.html')?.body ?? ''
		expect(en).toContain('href="https://www.next.aven.ceo/en/"') // canonical
		expect(en).not.toContain('${BASE_URL}')
	})
})

describe('resolveRoute on the assembled keys', () => {
	test('/ -> 302 /en/', () => expect(R('/')).toEqual({ status: 302, location: '/en/' }))
	test('/en/ -> 200', () => expect(R('/en/')).toEqual({ status: 200, key: 'en/' }))
	test('/de/ -> 200', () => expect(R('/de/')).toEqual({ status: 200, key: 'de/' }))
	test('/en/blog/ -> 200', () => expect(R('/en/blog/')).toEqual({ status: 200, key: 'en/blog/' }))
	test('/en/blog/founders-compass/ -> 200', () =>
		expect(R('/en/blog/founders-compass/')).toEqual({
			status: 200,
			key: 'en/blog/founders-compass/'
		}))
	test('/nope -> 404', () => expect(R('/nope')).toEqual({ status: 404, key: '404.html' }))
})
