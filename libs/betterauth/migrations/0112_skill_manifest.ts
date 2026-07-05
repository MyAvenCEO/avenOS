import { type Kysely, sql } from 'kysely'

// board 0119 — the SKILL MANIFEST: the dead `workflow` column (never seeded, never read) becomes
// `manifest` — config declaring each skill's DEFAULT entry view (Samuel: opening/calling a skill
// grounds the user in its context first — banking shows balance+transactions, inventory the live
// inventory, todos the overview — then the actual actor's card follows).

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE skill RENAME COLUMN workflow TO manifest`.execute(db)
	const seed = async (id: string, manifest: Record<string, unknown>) =>
		sql`UPDATE skill SET manifest = ${JSON.stringify(manifest)}::jsonb, updated_at = now() WHERE id = ${id}`.execute(db)
	await seed('todos', { vibe: 'todos' }) // client renders the LIVE todos view
	await seed('inventory', { schema: 'inventory', vibe: 'inventory' }) // live list through crud
	await seed('website', { vibe: 'composer' }) // the full composer
	// promoted skills default to their sandbox overview actor (real aggregates + latest rows).
	const promoted = await sql<{ skill_id: string }>`
		SELECT skill_id FROM actor WHERE name = skill_id || '_overview' AND code IS NOT NULL
	`.execute(db)
	for (const r of promoted.rows) await seed(r.skill_id, { actor: `${r.skill_id}_overview` })
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE skill RENAME COLUMN manifest TO workflow`.execute(db)
}
