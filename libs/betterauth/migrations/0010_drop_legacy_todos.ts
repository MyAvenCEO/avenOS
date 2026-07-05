import { type Kysely, sql } from 'kysely'

// Drop the legacy `todos` doctype (board 0087): todos are now gismu predications
// (pred:task + pred:valid, projected via v_task). The data_value FK cascades, so deleting
// the schema rows removes any leftover legacy values. Idempotent.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_schema WHERE name = 'todos'`.execute(db)
}

export async function down(): Promise<void> {
	// no-op — the legacy doctype is intentionally gone; predication schemas replace it.
}
