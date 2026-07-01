import { type Kysely, sql } from 'kysely'

// board 0100 — a predication IS (predicate, x1…x5). Only Lojban x1–x5 predications are legal (no
// free-form), so give data_value REAL columns instead of a jsonb blob: the DB enforces the shape, the
// data_schema AJV config validates the values per place, and every place becomes indexable/joinable.
// Backfill from the existing `data` jsonb; keep `data` transitionally (pgStore stops writing it).

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		ALTER TABLE data_value
			ADD COLUMN IF NOT EXISTS predicate text,
			ADD COLUMN IF NOT EXISTS x1 text,
			ADD COLUMN IF NOT EXISTS x2 text,
			ADD COLUMN IF NOT EXISTS x3 text,
			ADD COLUMN IF NOT EXISTS x4 text,
			ADD COLUMN IF NOT EXISTS x5 text
	`.execute(db)
	// backfill the columns from the jsonb (existing rows)
	await sql`
		UPDATE data_value SET
			predicate = COALESCE(predicate, data->>'predicate'),
			x1 = COALESCE(x1, data->>'x1'),
			x2 = COALESCE(x2, data->>'x2'),
			x3 = COALESCE(x3, data->>'x3'),
			x4 = COALESCE(x4, data->>'x4'),
			x5 = COALESCE(x5, data->>'x5')
		WHERE data IS NOT NULL
	`.execute(db)
	// `data` is now vestigial (pgStore writes the columns) — drop its NOT NULL so inserts need only the columns.
	await sql`ALTER TABLE data_value ALTER COLUMN data DROP NOT NULL`.execute(db)

	// The append-only history table + its trigger snapshot rows on UPDATE/DELETE — extend them to the
	// new columns (else deleting a column-only row fails the NOT-NULL on history.data). board 0004→0100.
	await sql`
		ALTER TABLE data_value_history
			ADD COLUMN IF NOT EXISTS predicate text,
			ADD COLUMN IF NOT EXISTS x1 text, ADD COLUMN IF NOT EXISTS x2 text, ADD COLUMN IF NOT EXISTS x3 text,
			ADD COLUMN IF NOT EXISTS x4 text, ADD COLUMN IF NOT EXISTS x5 text
	`.execute(db)
	await sql`ALTER TABLE data_value_history ALTER COLUMN data DROP NOT NULL`.execute(db)
	await sql`
		CREATE OR REPLACE FUNCTION data_value_history_snapshot()
		RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			INSERT INTO data_value_history (
				history_operation, id, user_id, schema_id, predicate, x1, x2, x3, x4, x5, data, created_at, updated_at
			) VALUES (
				TG_OP, OLD.id, OLD.user_id, OLD.schema_id,
				OLD.predicate, OLD.x1, OLD.x2, OLD.x3, OLD.x4, OLD.x5, OLD.data, OLD.created_at, OLD.updated_at
			);
			RETURN OLD;
		END;
		$$;
	`.execute(db)

	// query/join by any place (e.g. all predications whose x1 is a given entity)
	await sql`CREATE INDEX IF NOT EXISTS data_value_pred_x1 ON data_value (user_id, predicate, x1)`.execute(db)
	await sql`CREATE INDEX IF NOT EXISTS data_value_x2 ON data_value (user_id, x2)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP INDEX IF EXISTS data_value_pred_x1`.execute(db)
	await sql`DROP INDEX IF EXISTS data_value_x2`.execute(db)
	await sql`
		ALTER TABLE data_value
			DROP COLUMN IF EXISTS predicate,
			DROP COLUMN IF EXISTS x1, DROP COLUMN IF EXISTS x2, DROP COLUMN IF EXISTS x3,
			DROP COLUMN IF EXISTS x4, DROP COLUMN IF EXISTS x5
	`.execute(db)
}
