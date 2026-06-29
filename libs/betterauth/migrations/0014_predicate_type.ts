import { TODO_SPEC } from '@avenos/aven-ontology'
import { type Kysely, sql } from 'kysely'

// Composite TYPE registry (board 0088, Layer A) — admin-owned. Each row is a declarative bundle
// spec (an aven-ontology TypeSpec) describing how a type's fields map to x1–x5 predications. The
// generic engine loads it at runtime, so there is NO per-type code. Seeded with the `todos` type
// (the board 0087 bundle, now declarative). Mirrors the `flow` table. See [[two-layer-schema-split]].

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('predicate_type')
		.ifNotExists()
		.addColumn('type', 'text', (c) => c.primaryKey())
		.addColumn('spec', 'jsonb', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// Seed (idempotent + re-syncing) the todos type spec from the shipped aven-ontology default.
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${TODO_SPEC.type}, ${JSON.stringify(TODO_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('predicate_type').ifExists().execute()
}
