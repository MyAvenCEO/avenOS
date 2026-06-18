import { type Kysely, sql } from 'kysely'

// Token usage + per-model pricing for the authenticated AI proxy. board 0051.
// (Better Auth's own tables are managed by its CLI; these are ours, tracked in
// the kysely_migration table.)

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('model_pricing')
		.ifNotExists()
		.addColumn('model', 'text', (c) => c.primaryKey())
		.addColumn('input_usd_per_mtok', 'double precision', (c) => c.notNull().defaultTo(0))
		.addColumn('output_usd_per_mtok', 'double precision', (c) => c.notNull().defaultTo(0))
		.addColumn('request_usd', 'double precision', (c) => c.notNull().defaultTo(0))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createTable('ai_usage')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('model', 'text', (c) => c.notNull())
		.addColumn('prompt_tokens', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('completion_tokens', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('total_tokens', 'integer', (c) => c.notNull().defaultTo(0))
		.addColumn('cost_usd', 'double precision', (c) => c.notNull().defaultTo(0))
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createIndex('ai_usage_user_created_idx')
		.ifNotExists()
		.on('ai_usage')
		.columns(['user_id', 'created_at'])
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('ai_usage').ifExists().execute()
	await db.schema.dropTable('model_pricing').ifExists().execute()
}
