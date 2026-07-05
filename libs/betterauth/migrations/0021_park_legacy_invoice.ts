import { type Kysely, sql } from 'kysely'

// Board 0090 migrate+drop, part 1 (park). The OLD JSON-blob `invoice` data_schema shares the name
// `invoice` with the new ontology primary predicate (janta). Park the blob schema out of the way so
// `ensurePredicateSchemas` can create the janta `invoice` cleanly; the parked legacy rows are then
// converted to predications + the parked schema dropped (part 2, run live — see the card). Blob-shaped
// only (no `predicate` property) + idempotent, so it never touches an already-migrated janta schema.
// Runs at BOOT, before any runtime data_crud — so the rename wins the race against ensurePredicateSchemas.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE data_schema SET name = 'invoice_blob_legacy', updated_at = now()
		WHERE name = 'invoice' AND json_schema->'properties'->'predicate' IS NULL
	`.execute(db)
}

export async function down(): Promise<void> {
	// one-way park; the legacy data is converted to predications then dropped
}
