import { type Kysely, sql } from 'kysely'

// Re-project v_task using the CANONICAL gismu place structures (board 0087):
//   valid ≡ ranji  → x1 = task            (join val.x1 = task)
//   due   ≡ detri  → x1 = DATE, x2 = task (join due.x2 = task, read due.x1 as the date)
//   prioritized ≡ vajni → x1 = task, x3 = level (join prio.x1 = task, read prio.x3 as the level)
// Same output columns as before (id,user_id,what,valid_from,open,due_date,priority) so CREATE OR
// REPLACE is valid — only the joins/reads change to match the de-adapted predicates.

export async function up(db: Kysely<unknown>): Promise<void> {
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
		JOIN data_schema ts ON ts.id = t.schema_id AND ts.name = 'pred:task'
		LEFT JOIN data_schema vs ON vs.name = 'pred:valid' AND vs.user_id = t.user_id
		LEFT JOIN data_value val ON val.schema_id = vs.id AND val.data->>'x1' = t.id
		LEFT JOIN data_schema ds ON ds.name = 'pred:due' AND ds.user_id = t.user_id
		LEFT JOIN data_value due ON due.schema_id = ds.id AND due.data->>'x2' = t.id
		LEFT JOIN data_schema ps ON ps.name = 'pred:prioritized' AND ps.user_id = t.user_id
		LEFT JOIN data_value prio ON prio.schema_id = ps.id AND prio.data->>'x1' = t.id
	`.execute(db)
}

export async function down(): Promise<void> {
	// keep the view
}
