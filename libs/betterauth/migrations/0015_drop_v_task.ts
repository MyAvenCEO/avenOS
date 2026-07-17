import { type Kysely, sql } from 'kysely'

// The aven-ontology Datalog matcher (board 0088) projects todos directly from the predications,
// superseding the hand-written `v_task` SQL view (board 0087). Drop it — the generic engine is now
// the only reader, and there is no per-type view anymore.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DROP VIEW IF EXISTS v_task`.execute(db)
}

export async function down(): Promise<void> {
	// the matcher replaces it; nothing to restore
}
