import { type Kysely, sql } from 'kysely'

// Extend v_task with the rest of the todo predication bundle (board 0087): a task's optional
// `due` (pred:due) and `priority` (pred:prioritized), each a predication that refs the task.
// CREATE OR REPLACE keeps the existing columns + appends due_date/priority at the end.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE OR REPLACE VIEW v_task AS
		SELECT
			t.id,
			t.user_id,
			t.data->>'x2'              AS what,
			(val.data->>'x2')          AS valid_from,
			(val.data->>'x3') IS NULL  AS open,
			(due.data->>'x2')          AS due_date,
			(prio.data->>'x2')         AS priority
		FROM data_value t
		JOIN data_schema ts ON ts.id = t.schema_id AND ts.name = 'pred:task'
		LEFT JOIN data_schema vs ON vs.name = 'pred:valid' AND vs.user_id = t.user_id
		LEFT JOIN data_value val ON val.schema_id = vs.id AND val.data->>'x1' = t.id
		LEFT JOIN data_schema ds ON ds.name = 'pred:due' AND ds.user_id = t.user_id
		LEFT JOIN data_value due ON due.schema_id = ds.id AND due.data->>'x1' = t.id
		LEFT JOIN data_schema ps ON ps.name = 'pred:prioritized' AND ps.user_id = t.user_id
		LEFT JOIN data_value prio ON prio.schema_id = ps.id AND prio.data->>'x1' = t.id
	`.execute(db)
}

export async function down(): Promise<void> {
	// keep the view; the extra columns are additive.
}
