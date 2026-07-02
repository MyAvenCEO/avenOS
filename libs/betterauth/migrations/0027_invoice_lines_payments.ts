import { INVOICE_SPEC } from '../src/legacy-bundle-fixtures'
import { type Kysely, sql } from 'kysely'

// board 0092 step 2b — the invoice composite now carries nested CHILDREN: line items (line≡pagbu with
// description/quantity/unit_price/line_amount) and payments (payment≡pleji with paid_on≡detri), each a
// sub-entity projected back as an array. Re-seed the predicate_type spec so loadTypeSpec returns the
// children parts; the per-predicate data_schema rows (line/description/quantity/unit_price/line_amount/
// payment/paid_on) are seeded lazily by ensurePredicateSchemas on the next data call. No data re-sync
// (existing invoices simply have empty lines/payments until re-ingested). aven-db CRDT untouched.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${INVOICE_SPEC.type}, ${JSON.stringify(INVOICE_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// best-effort: drop the line/payment sub-entity predications + schemas this step introduced.
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('line','description','quantity','unit_price','line_amount','payment','paid_on'))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN ('line','description','quantity','unit_price','line_amount','payment','paid_on')`.execute(db)
}
