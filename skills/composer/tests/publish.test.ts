// biome-ignore-all lint/suspicious/noTemplateCurlyInString: assertions reference the literal ${BASE_URL} token
import { describe, expect, test } from 'bun:test'
import { deploySite } from '../publish'
import { SEED_SRC } from '../seed'

const HOST = 'https://www.next.aven.ceo'

/** A storage mock that records every upload — the injected-storage seam that makes deploy testable. */
function mockStorage() {
	const uploads: { key: string; body: string; contentType?: string; cacheControl?: string }[] = []
	return {
		uploads,
		upload: async (
			key: string,
			body: string,
			opts?: { contentType?: string; cacheControl?: string }
		) => {
			uploads.push({ key, body, contentType: opts?.contentType, cacheControl: opts?.cacheControl })
		}
	}
}

describe('deploySite (publish to an injected storage)', () => {
	test('uploads the full assembled key set', async () => {
		const s = mockStorage()
		await deploySite(SEED_SRC, s, { host: HOST })
		const keys = new Set(s.uploads.map((u) => u.key))
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
			'sitemap.xml',
			'robots.txt'
		]) {
			expect(keys.has(k)).toBe(true)
		}
	})

	test('returns count === uploaded objects, deterministically', async () => {
		const a = mockStorage()
		const b = mockStorage()
		const r1 = await deploySite(SEED_SRC, a, { host: HOST })
		const r2 = await deploySite(SEED_SRC, b, { host: HOST })
		expect(r1.count).toBe(a.uploads.length)
		expect(r1.count).toBe(r2.count) // deterministic object count
		expect(r1.url).toBe(`${HOST}/en/`)
	})

	test('${BASE_URL} is resolved to the host in uploaded bodies', async () => {
		const s = mockStorage()
		await deploySite(SEED_SRC, s, { host: HOST })
		const home = s.uploads.find((u) => u.key === 'en/index.html')
		expect(home?.body).toContain(`href="${HOST}/en/"`) // canonical link points at the live host
		expect(home?.body).not.toContain('${BASE_URL}') // no unresolved placeholder shipped
	})

	test('uploads carry content-type + cache-control', async () => {
		const s = mockStorage()
		await deploySite(SEED_SRC, s, { host: HOST })
		const css = s.uploads.find((u) => u.key === 'styles.css')
		const home = s.uploads.find((u) => u.key === 'en/')
		expect(css?.contentType).toContain('text/css')
		expect(home?.contentType).toContain('text/html')
		expect(home?.cacheControl).toContain('max-age')
	})
})
