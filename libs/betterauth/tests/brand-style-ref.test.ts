import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { db } from '../src/db'
import { loadVibe } from '../src/vibe-registry'

// board 0115 — the BRAND layer is a REFERENCED style row, not a baked copy: style rows carry
// `extends: 'brand'` and the server composes base-under-own at serve time. One brand row, zero
// duplicates, a brand edit re-styles every extending vibe on its next load.

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

d('board 0115 — brand as a referenced style row (serve-time composition)', () => {
	test('the brand row exists and carries the shared base (:host + primitives)', async () => {
		const r = await sql<{ body: unknown }>`SELECT body FROM vibe_style WHERE name = 'brand'`.execute(db())
		const body = JSON.stringify(r.rows[0]?.body ?? {})
		expect(body).toContain(':host')
		expect(body).toContain('grid-card')
	})

	test('a stored row is RAW (extends ref, no baked brand); the SERVED style is composed', async () => {
		const stored = await sql<{ body: unknown }>`SELECT body FROM vibe_style WHERE name = 'goals'`.execute(db())
		const raw = stored.rows[0]?.body as { extends?: string; selectors?: Record<string, unknown> }
		expect(raw.extends).toBe('brand')
		expect(raw.selectors?.[':host']).toBeUndefined() // nothing baked
		const served = (await loadVibe('goals'))?.style as { selectors?: Record<string, unknown> }
		expect(served.selectors?.[':host']).toBeTruthy() // brand base composed in
		expect(served.selectors?.['.gl-grid']).toBeTruthy() // own layer intact
	})

	test('own layer WINS over the base on conflict (tokens merge, own over brand)', async () => {
		const served = (await loadVibe('todos-created'))?.style as { tokens?: Record<string, unknown> }
		expect(served.tokens?.['bg-a']).toBeTruthy() // from the brand row
		expect(served.tokens?.['prio-high']).toBe('#c1502e') // the card style's own token
	})

	test('a missing base never breaks a render: the own layer is served as-is', async () => {
		await sql`
			INSERT INTO vibe_view (name, body) VALUES ('zzz-ref-probe', ${'{"content":{"class":"x"}}'}::jsonb)
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body
		`.execute(db())
		await sql`
			INSERT INTO vibe_style (name, body)
			VALUES ('zzz-ref-probe', ${'{"extends":"does-not-exist","selectors":{".x":{"color":"red"}}}'}::jsonb)
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body
		`.execute(db())
		const served = (await loadVibe('zzz-ref-probe'))?.style as {
			selectors?: Record<string, unknown>
		}
		expect(served.selectors?.['.x']).toBeTruthy()
	})

	afterAll(async () => {
		if (!DB) return
		for (const t of ['vibe_view', 'vibe_style'])
			await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'zzz-ref-probe'`.execute(db())
	})
})
