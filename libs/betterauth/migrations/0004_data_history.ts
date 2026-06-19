import { type Kysely, sql } from 'kysely'

// Historical snapshots for the generic user data store (board 0053).
// The live tables keep the latest state; these append-only tables keep every previous
// state on UPDATE and DELETE via Postgres triggers. No FKs here: history must survive
// cascades and parent deletes.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('data_schema_history')
		.ifNotExists()
		.addColumn('history_id', sql`bigint generated always as identity`, (c) => c.primaryKey())
		.addColumn('history_operation', 'text', (c) => c.notNull())
		.addColumn('history_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('id', 'text', (c) => c.notNull())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('json_schema', 'jsonb', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull())
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull())
		.execute()

	await db.schema
		.createTable('data_value_history')
		.ifNotExists()
		.addColumn('history_id', sql`bigint generated always as identity`, (c) => c.primaryKey())
		.addColumn('history_operation', 'text', (c) => c.notNull())
		.addColumn('history_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('id', 'text', (c) => c.notNull())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('schema_id', 'text', (c) => c.notNull())
		.addColumn('data', 'jsonb', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull())
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull())
		.execute()

	await sql`
		DO $$
		BEGIN
			ALTER TABLE data_schema_history
				ADD CONSTRAINT data_schema_history_operation_chk
				CHECK (history_operation IN ('UPDATE', 'DELETE'));
		EXCEPTION WHEN duplicate_object THEN NULL;
		END $$;
	`.execute(db)

	await sql`
		DO $$
		BEGIN
			ALTER TABLE data_value_history
				ADD CONSTRAINT data_value_history_operation_chk
				CHECK (history_operation IN ('UPDATE', 'DELETE'));
		EXCEPTION WHEN duplicate_object THEN NULL;
		END $$;
	`.execute(db)

	await db.schema
		.createIndex('data_schema_history_row_at_idx')
		.ifNotExists()
		.on('data_schema_history')
		.columns(['id', 'history_at'])
		.execute()

	await db.schema
		.createIndex('data_schema_history_user_at_idx')
		.ifNotExists()
		.on('data_schema_history')
		.columns(['user_id', 'history_at'])
		.execute()

	await db.schema
		.createIndex('data_value_history_row_at_idx')
		.ifNotExists()
		.on('data_value_history')
		.columns(['id', 'history_at'])
		.execute()

	await db.schema
		.createIndex('data_value_history_user_schema_at_idx')
		.ifNotExists()
		.on('data_value_history')
		.columns(['user_id', 'schema_id', 'history_at'])
		.execute()

	await sql`
		CREATE OR REPLACE FUNCTION data_schema_history_snapshot()
		RETURNS trigger
		LANGUAGE plpgsql
		AS $$
		BEGIN
			INSERT INTO data_schema_history (
				history_operation,
				id,
				user_id,
				name,
				json_schema,
				created_at,
				updated_at
			) VALUES (
				TG_OP,
				OLD.id,
				OLD.user_id,
				OLD.name,
				OLD.json_schema,
				OLD.created_at,
				OLD.updated_at
			);
			RETURN OLD;
		END;
		$$;
	`.execute(db)

	await sql`
		CREATE OR REPLACE FUNCTION data_value_history_snapshot()
		RETURNS trigger
		LANGUAGE plpgsql
		AS $$
		BEGIN
			INSERT INTO data_value_history (
				history_operation,
				id,
				user_id,
				schema_id,
				data,
				created_at,
				updated_at
			) VALUES (
				TG_OP,
				OLD.id,
				OLD.user_id,
				OLD.schema_id,
				OLD.data,
				OLD.created_at,
				OLD.updated_at
			);
			RETURN OLD;
		END;
		$$;
	`.execute(db)

	await sql`DROP TRIGGER IF EXISTS data_schema_history_update_delete ON data_schema`.execute(db)
	await sql`
		CREATE TRIGGER data_schema_history_update_delete
		AFTER UPDATE OR DELETE ON data_schema
		FOR EACH ROW
		EXECUTE FUNCTION data_schema_history_snapshot();
	`.execute(db)

	await sql`DROP TRIGGER IF EXISTS data_value_history_update_delete ON data_value`.execute(db)
	await sql`
		CREATE TRIGGER data_value_history_update_delete
		AFTER UPDATE OR DELETE ON data_value
		FOR EACH ROW
		EXECUTE FUNCTION data_value_history_snapshot();
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TRIGGER IF EXISTS data_value_history_update_delete ON data_value`.execute(db)
	await sql`DROP TRIGGER IF EXISTS data_schema_history_update_delete ON data_schema`.execute(db)
	await sql`DROP FUNCTION IF EXISTS data_value_history_snapshot()`.execute(db)
	await sql`DROP FUNCTION IF EXISTS data_schema_history_snapshot()`.execute(db)
	await db.schema.dropTable('data_value_history').ifExists().execute()
	await db.schema.dropTable('data_schema_history').ifExists().execute()
}