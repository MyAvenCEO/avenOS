import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOG, reconcile, skillById, skillBySlug, slugOf } from '../src/index'

/**
 * The catalog is only a single source of truth if something notices when a
 * consumer drifts from it. These tests read the REAL website content directory
 * and the REAL app registry — not copies — so adding a skill on one side and
 * forgetting the other fails here rather than in someone's face.
 */

const ROOT = join(import.meta.dir, '../../..')

/** Every slug the website ships an English content file for. */
function websiteSlugs(): string[] {
	const dir = join(ROOT, 'libs/aven-website/src/lib/skills/content/en')
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => f.replace(/\.json$/, ''))
		.sort()
}

/** Every skill id the app's registry declares. */
async function appSkillIds(): Promise<string[]> {
	const { skills } = await import(join(ROOT, 'app/src/lib/skills/registry.ts'))
	return (skills as { id: string }[]).map((s) => s.id).sort()
}

describe('the catalog itself', () => {
	test('ids are unique', () => {
		const ids = CATALOG.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('public slugs are unique — they are URLs', () => {
		const slugs = CATALOG.map(slugOf)
		expect(new Set(slugs).size).toBe(slugs.length)
	})

	test('lookup works by id and by slug, and a slug defaults to the id', () => {
		expect(skillById('inbox')?.name).toBe('Email Manager')
		expect(skillBySlug('email-manager')?.id).toBe('inbox')
		// `human-reviewer` has no separate slug, so its id IS its slug.
		expect(skillBySlug('human-reviewer')?.id).toBe('human-reviewer')
		expect(skillById('nope')).toBeUndefined()
	})

	test('every entry says what it does and which tier it comes with', () => {
		for (const s of CATALOG) {
			expect(s.name.length).toBeGreaterThan(0)
			expect(s.tagline.length).toBeGreaterThan(0)
			expect(['avenme', 'avenceo']).toContain(s.plan)
		}
	})
})

describe('reconcile — the guard both consumers run', () => {
	test('names what is covered, what is invented, and what is unimplemented', () => {
		const r = reconcile(['inbox', 'made-up'])
		expect(r.known).toEqual(['inbox'])
		expect(r.unknown).toEqual(['made-up'])
		expect(r.missing).toContain('docs')
		expect(r.missing).not.toContain('inbox')
	})
})

describe('the website agrees with the catalog', () => {
	test('every content file belongs to a catalog entry', () => {
		const unknown = websiteSlugs().filter((slug) => skillBySlug(slug) === undefined)
		expect(unknown).toEqual([])
	})

	test('every catalog entry has website content', () => {
		const shipped = new Set(websiteSlugs())
		const missing = CATALOG.map(slugOf).filter((slug) => !shipped.has(slug))
		expect(missing).toEqual([])
	})
})

describe('the app agrees with the catalog', () => {
	test('every registered skill is a catalog entry', async () => {
		const { unknown } = reconcile(await appSkillIds())
		expect(unknown).toEqual([])
	})

	test('everything the catalog calls built has a workflow behind it', async () => {
		const built = new Set(await appSkillIds())
		const promisedButAbsent = CATALOG.filter((s) => !s.comingSoon && !built.has(s.id)).map(
			(s) => s.id
		)
		// `human-reviewer` and `blog-writer` are sold but not skills in the app —
		// the first is the HITL gate itself, the second has no runtime yet. They
		// are named here rather than quietly excluded, so the day one is built
		// this list is what tells us to shorten it.
		expect(promisedButAbsent).toEqual(['human-reviewer', 'blog-writer'])
	})
})
