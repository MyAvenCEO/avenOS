import { type Kysely, sql } from 'kysely'

// x1–x5 predications ARE the universal data-type model — drop the `pred:` namespace prefix that
// leaked into the DB/UI (the DB viewer showed `pred:task` etc.). Rename existing data_schema rows
// IN PLACE so schema_id is preserved → the data_value FK + the user's predications are untouched
// (NO cascade delete), then re-point v_task at the bare data-type names. board 0088 framing.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE data_schema SET name = substring(name FROM 6), updated_at = now()
		WHERE name LIKE 'pred:%'
	`.execute(db)
	await sql`
		CREATE OR REPLACE VIEW v_task AS
		SELECT
			t.id,
			t.user_id,
			t.data->>'x2'              AS what,
			(val.data->>'x2')          AS valid_from,
			(val.data->>'x3') IS NULL  AS open,
			(due.data->>'x1')          AS due_date,
			(prio.data->>'x3')         AS priority
		FROM data_value t
		JOIN data_schema ts ON ts.id = t.schema_id AND ts.name = 'task'
		LEFT JOIN data_schema vs ON vs.name = 'valid' AND vs.user_id = t.user_id
		LEFT JOIN data_value val ON val.schema_id = vs.id AND val.data->>'x1' = t.id
		LEFT JOIN data_schema ds ON ds.name = 'due' AND ds.user_id = t.user_id
		LEFT JOIN data_value due ON due.schema_id = ds.id AND due.data->>'x2' = t.id
		LEFT JOIN data_schema ps ON ps.name = 'prioritized' AND ps.user_id = t.user_id
		LEFT JOIN data_value prio ON prio.schema_id = ps.id AND prio.data->>'x1' = t.id
	`.execute(db)
}

export async function down(): Promise<void> {
	// keep the bare names + view
}
