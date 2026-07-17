import { describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { db } from '../src/db'
import { loadVibe } from '../src/vibe-registry'

// board 0114 — every dynamic vibe must PREVIEW with representative data: each vibe_view row (except the
// special-cased `website` Composer) carries a vibe_source row with a non-empty example source, and the
// bundle endpoint serves it. This is the "double-check all of them" as a standing gate — a new vibe
// without a sample fails here instead of previewing as its empty state.

async function hasDb(): Promise<boolean> {
	try {
		await sql`SELECT 1`.execute(db())
		return true
	} catch {
		return false
	}
}
const DB = await hasDb()
const d = DB ? describe : describe.skip
const SPECIAL = new Set(['website']) // the Composer — its own Svelte surface, not an engine render

d('board 0114 — vibe_source completeness (every vibe previews with example data)', () => {
	test('every vibe_view row has a non-empty vibe_source row', async () => {
		const views = await sql<{ name: string }>`SELECT name FROM vibe_view ORDER BY name`.execute(db())
		const sources = await sql<{ name: string; body: unknown }>`
			SELECT name, body FROM vibe_source
		`.execute(db())
		const srcBy = new Map(sources.rows.map((r) => [r.name, r.body]))
		const missing: string[] = []
		for (const v of views.rows) {
			if (SPECIAL.has(v.name)) continue
			const body = srcBy.get(v.name)
			const obj = typeof body === 'string' ? JSON.parse(body) : body
			if (!obj || typeof obj !== 'object' || Object.keys(obj as object).length === 0)
				missing.push(v.name)
		}
		expect(missing, `vibes missing an example source: ${missing.join(', ')}`).toEqual([])
	})

	test('the bundle endpoint serves the example source', async () => {
		const bundle = await loadVibe('inventory-locations')
		expect(bundle?.source).toBeTruthy()
		const src = bundle?.source as { locations?: unknown[] }
		expect(Array.isArray(src.locations)).toBe(true)
		expect(src.locations!.length).toBeGreaterThan(0)
	})
})
