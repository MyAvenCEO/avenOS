import { type Kysely, sql } from 'kysely'
import { VIBE_SOURCES } from '../src/vibe-samples'

// board 0114 — the `vibe_source` registry: EXAMPLE source data per vibe, as config-as-data (mirrors
// vibe_view/vibe_style/vibe_logic from 0034). Served with the bundle so every dynamic-vibe PREVIEW
// (DB viewer, Skills actor previews) renders representative data instead of the empty state — and the
// duplicated hardcoded sample maps in the app die. Seeded from the vibe-samples TS SSOT.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('vibe_source')
		.ifNotExists()
		.addColumn('name', 'text', (c) => c.primaryKey())
		.addColumn('body', sql`jsonb`, (c) => c.notNull())
		.addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
		.execute()
	for (const [name, body] of Object.entries(VIBE_SOURCES)) {
		await sql`
			INSERT INTO vibe_source (name, body) VALUES (${name}, ${JSON.stringify(body)}::jsonb)
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('vibe_source').ifExists().execute()
}
