import { todoLogic, todoStyle, todoView } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — the Planner card learns the new fields: a GOAL chip (brand-navy ✳ tint, distinct from the
// priority tones), and SUB-TASKS rendered indented under their parent with a ↳ marker (the logic orders
// children depth-first after their parent). Re-seed the todos vibe view/style/logic from the aven-vibes TS
// SSOT (the 0067 pattern) so the live shadow-DOM render picks it up.

async function upsertJson(
	db: Kysely<unknown>,
	table: 'vibe_view' | 'vibe_style',
	name: string,
	value: unknown
): Promise<void> {
	await sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await upsertJson(db, 'vibe_view', 'todos', todoView)
	await upsertJson(db, 'vibe_style', 'todos', todoStyle)
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES ('todos', ${todoLogic})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function down(): Promise<void> {
	// forward-only: re-running 0067 restores the pre-Planner card.
}
