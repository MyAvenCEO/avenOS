import { EXAMPLE_FLOWS } from '@avenos/aven-skills'
import { type Kysely, sql } from 'kysely'

// Flow/skill CONFIG templates (board 0087, Layer A) — admin-owned, normal PG table (NOT the
// dynamic data_schema/data_value store). Seeded from the shipped EXAMPLE_FLOWS (which includes
// the `project-planner` flow). See [[two-layer-schema-split]].

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('flow')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
		.addColumn('nodes', 'jsonb', (c) => c.notNull())
		.addColumn('edges', 'jsonb', (c) => c.notNull())
		.addColumn('triggers', 'jsonb')
		.addColumn('resource_labels', 'jsonb')
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// Seed the platform's example flow configs (idempotent). Raw SQL keeps the migration
	// independent of the typed Database (migrations run against Kysely<unknown>).
	for (const f of EXAMPLE_FLOWS) {
		await sql`
			INSERT INTO flow (id, name, description, nodes, edges, triggers, resource_labels)
			VALUES (
				${f.id}, ${f.name}, ${f.description ?? ''},
				${JSON.stringify(f.nodes)}::jsonb, ${JSON.stringify(f.edges)}::jsonb,
				${f.triggers ? JSON.stringify(f.triggers) : null}::jsonb,
				${f.resourceLabels ? JSON.stringify(f.resourceLabels) : null}::jsonb
			)
			ON CONFLICT (id) DO NOTHING
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('flow').ifExists().execute()
}
