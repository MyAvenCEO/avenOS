import { type Kysely, sql } from 'kysely'

// board 0093 step 1 — historically embedded each doctype's system_prompt + tool-call schema into its
// `extract_document` node (capture/capture-bank) and retired the redundant `invoice-ingest` flow.
// board 0099 stripped the document extraction verticals (those flows are dropped downstream), so the
// embed is now a no-op — only the historical `invoice-ingest` removal is kept for replay integrity.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM flow WHERE id = 'invoice-ingest'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only.
}
