import { type Kysely, sql } from 'kysely'

// board 0099 — 0046 stripped the legacy predicate schemas, but `ensurePredicateSchemas` kept RE-SEEDING
// document/invoice/contact vocab on every todos op, so they reappeared (empty). That seeding is now
// todos-only, so purge them once more — this time they stay gone. Same exclusive-vertical set as 0046;
// the SHARED owned_by/due are orphan-cleaned (only rows whose linked entity no longer exists).

const DOOMED_PREDS = [
	'address', 'balance', 'booked', 'company', 'contact', 'dated', 'description', 'document',
	'identifier', 'invoice', 'invoice_doc', 'kind', 'line', 'line_amount', 'matched', 'name',
	'paid_on', 'payment', 'person', 'produced', 'quantity', 'represents', 'source', 'summary',
	'total', 'transaction', 'unit_price', 'value_dated'
]

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name = ANY(${DOOMED_PREDS}))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name = ANY(${DOOMED_PREDS})`.execute(db)
	await sql`
		DELETE FROM data_value
		WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('owned_by','due'))
		  AND data ? 'x2'
		  AND data->>'x2' NOT IN (SELECT id FROM data_value)
	`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only.
}
