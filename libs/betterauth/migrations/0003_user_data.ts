import { type Kysely, sql } from 'kysely'

// Generic, schema-driven user data. `data_schema` rows are JSON Schema definitions the
// user creates; `data_value` rows reference a schema (FK) and hold a JSONB value that is
// validated against that schema on write. Fully generic — any future schema. Per-user via
// user_id. board 0053.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('data_schema')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('json_schema', 'jsonb', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// One schema name per user (lets the client upsert/seed by name, e.g. "todos").
	await db.schema
		.createIndex('data_schema_user_name_uidx')
		.ifNotExists()
		.on('data_schema')
		.columns(['user_id', 'name'])
		.unique()
		.execute()

	await db.schema
		.createTable('data_value')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('schema_id', 'text', (c) =>
			c.notNull().references('data_schema.id').onDelete('cascade')
		)
		.addColumn('data', 'jsonb', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createIndex('data_value_user_schema_created_idx')
		.ifNotExists()
		.on('data_value')
		.columns(['user_id', 'schema_id', 'created_at'])
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('data_value').ifExists().execute()
	await db.schema.dropTable('data_schema').ifExists().execute()
}
