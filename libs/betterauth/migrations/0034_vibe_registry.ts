import { todoLogic, todoStyle, todoView } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0095 — the `vibe.*` registry: vibe definitions become admin-owned config-as-data (Layer A),
// alongside flow + predicate_type. SEPARATE tables so a view / style / logic is an independently
// shareable, named entity: vibe_view (the ViewDef tree), vibe_style (the StyleDef), vibe_logic (the
// sandbox-quickjs JS). Seeds the `todos` pilot from its current files; the files become the seed SOURCE.

async function ensure(db: Kysely<unknown>, table: string, bodyType: 'jsonb' | 'text'): Promise<void> {
	await db.schema
		.createTable(table)
		.ifNotExists()
		.addColumn('name', 'text', (c) => c.primaryKey())
		.addColumn('body', sql.raw(bodyType), (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await ensure(db, 'vibe_view', 'jsonb')
	await ensure(db, 'vibe_style', 'jsonb')
	await ensure(db, 'vibe_logic', 'text')

	await sql`
		INSERT INTO vibe_view (name, body) VALUES ('todos', ${JSON.stringify(todoView)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO vibe_style (name, body) VALUES ('todos', ${JSON.stringify(todoStyle)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES ('todos', ${todoLogic})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('vibe_logic').ifExists().execute()
	await db.schema.dropTable('vibe_style').ifExists().execute()
	await db.schema.dropTable('vibe_view').ifExists().execute()
}
