import { INVOICE_SPEC } from '../src/legacy-bundle-fixtures'
import { type Kysely, sql } from 'kysely'

// Register the `invoice` composite type (board 0090) in the predicate_type registry — the invoice
// vertical as a 0088 type (janta/jdima/vendor + reused due/krasi/finti). Generic engine loads it at
// runtime; no per-type code. Seeded (re-syncing) from the aven-ontology default.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${INVOICE_SPEC.type}, ${JSON.stringify(INVOICE_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM predicate_type WHERE type = 'invoice'`.execute(db)
}
