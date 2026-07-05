import { afterAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { db } from '../src/db'
import { authoringInstructions, QUERY_INSTRUCTIONS } from '../src/query-caps'

// board 0112 — the GLM authoring instructions are DB CONFIG: authoringInstructions() serves the query/mutate
// ACTOR row's `prompt` (seeded by migration 0071, incl. the chained-join grammar) and only falls back to the
// TS constant when the row is missing/empty. Proven live: the seeded prompt is served; a sentinel written to
// the row is served verbatim; nulling the row falls back to the TS constant. Restores the row afterwards.

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

const readRow = async (): Promise<string | null> => {
	const r = await sql<{ prompt: string | null }>`
		SELECT prompt FROM actor WHERE name = 'query' LIMIT 1
	`.execute(db())
	return r.rows[0]?.prompt ?? null
}
const writeRow = async (prompt: string | null): Promise<void> => {
	await sql`UPDATE actor SET prompt = ${prompt}, updated_at = now() WHERE name = 'query'`.execute(
		db()
	)
}
let original: string | null = null

d('board 0112 — authoring prompts served from the actor rows', () => {
	test('the seeded query prompt is non-empty and teaches the chain grammar', async () => {
		original = await readRow()
		expect(original ?? '').toContain('CHAINS')
		expect(await authoringInstructions('query')).toBe(original as string)
	})

	test('a sentinel written to the row is served verbatim (DB is the SSOT)', async () => {
		await writeRow('SENTINEL-0112-PROMPT')
		expect(await authoringInstructions('query')).toBe('SENTINEL-0112-PROMPT')
	})

	test('a nulled row falls back to the TS constant (fail-safe)', async () => {
		await writeRow(null)
		expect(await authoringInstructions('query')).toBe(QUERY_INSTRUCTIONS)
	})

	afterAll(async () => {
		if (!DB) return
		await writeRow(original) // restore the seeded prompt whatever happened above
	})
})
