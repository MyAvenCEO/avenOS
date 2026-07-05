import { type Kysely, sql } from 'kysely'

// Predication projection (board 0087, Layer B). `v_task` projects todos stored as gismu
// predications back into named columns: a `pred:task` data_value joined to its `pred:valid`
// (open = the valid interval's end x3 is null). The pred:* data_schema rows are ensured
// on-demand per user by the rewired todos path; this view is a global SQL object.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE OR REPLACE VIEW v_task AS
		SELECT
			t.id,
			t.user_id,
			t.data->>'x2'                  AS what,
			(val.data->>'x2')              AS valid_from,
			(val.data->>'x3') IS NULL      AS open
		FROM data_value t
		JOIN data_schema ts ON ts.id = t.schema_id AND ts.name = 'pred:task'
		LEFT JOIN data_schema vs ON vs.name = 'pred:valid' AND vs.user_id = t.user_id
		LEFT JOIN data_value val ON val.schema_id = vs.id AND val.data->>'x1' = t.id
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP VIEW IF EXISTS v_task`.execute(db)
}
