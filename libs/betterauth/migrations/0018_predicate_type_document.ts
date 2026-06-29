import { DOCUMENT_SPEC } from '@avenos/aven-ontology'
import { type Kysely, sql } from 'kysely'

// Register the `document` composite type (board 0089) in the predicate_type registry — the doc-ingest
// skill's output as a 0088 type (classified document + krasi provenance + finti lineage). The generic
// engine loads it at runtime; no per-type code. Seeded (re-syncing) from the aven-ontology default.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${DOCUMENT_SPEC.type}, ${JSON.stringify(DOCUMENT_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM predicate_type WHERE type = 'document'`.execute(db)
}
