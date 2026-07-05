import { COMPANY_SPEC, DOCUMENT_SPEC, INVOICE_SPEC, PERSON_SPEC, TRANSACTION_SPEC } from '../src/legacy-bundle-fixtures'
import { type Kysely, sql } from 'kysely'

// board 0097 — the canonical ontology re-audit. The composite specs are re-seeded with their
// CONSOLIDATED shapes: contact channels collapse into ONE `address`≡judri (the channel in x3 = a
// `addrsys-*` ref) and identifiers into ONE `identifier`≡tcita (the kind in x1 = an `idkind-*` ref);
// the document type is `kind`≡tcita (x1 = a `doctype-*` ref); the invoice number folds into
// `identifier`; `vendor`≡vecnu and `classified`≡klesi are retired. The per-predicate data_schema rows
// (address/identifier/kind/…) are seeded lazily by ensurePredicateSchemas on the next data call.
//
// The Neon dev branch is reset FRESH for this (no legacy data to rewrite), so beyond the spec upsert we
// only DROP any data still sitting under a retired predicate name — keeping the consolidated vocab the
// single source of truth. On a fresh branch every DELETE is a harmless no-op. aven-db CRDT untouched.

const RETIRED = ['email', 'phone', 'iban', 'postal', 'vat_id', 'tax_number', 'classified', 'number', 'vendor']

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. re-seed the consolidated composite specs into the predicate_type registry (Layer A).
	for (const spec of [DOCUMENT_SPEC, INVOICE_SPEC, PERSON_SPEC, COMPANY_SPEC, TRANSACTION_SPEC]) {
		await sql`
			INSERT INTO predicate_type (type, spec)
			VALUES (${spec.type}, ${JSON.stringify(spec)}::jsonb)
			ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
		`.execute(db)
	}
	// 2. drop any data left under a retired per-channel / per-identifier / klesi predicate (data_value
	// first for the FK, then the orphaned data_schema rows). No-op on a fresh branch.
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN (${sql.join(RETIRED)}))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN (${sql.join(RETIRED)})`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only: the consolidated vocab supersedes the per-channel predicates; reverting would
	// re-introduce the retired predicates with no faithful data to restore.
}
