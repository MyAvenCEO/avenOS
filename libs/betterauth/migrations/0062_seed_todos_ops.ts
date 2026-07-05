import { randomUUID } from 'node:crypto'
import { type Kysely, sql } from 'kysely'
import { deriveOps } from '../src/derive-ops'

// board 0104 — derive the `todos` bundle's standard operations (todos.list/create/update/delete) into
// data_operations as GLOBAL rows (user_id NULL). After this the todos skill is 100% visible data: the
// bundle row (data_bundles) + its derived op rows (data_operations) + its vibe rows (vibe_*). saveType
// regenerates these on every future bundle change; this seeds the already-present todos bundle once.

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{
		spec: unknown
	}>`SELECT spec FROM data_bundles WHERE type = 'todos'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	// biome-ignore lint/suspicious/noExplicitAny: the stored spec is a TypeSpec by construction
	const ops = deriveOps(asJson(row.spec) as any)
	await sql`DELETE FROM data_operations WHERE derived_from = 'todos'`.execute(db)
	for (const o of ops) {
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, derived_from, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, ${o.name}, ${o.kind}, ${JSON.stringify(o.spec)}::jsonb, 'todos', now(), now())
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE derived_from = 'todos'`.execute(db)
}
