import { COMPANY_SPEC, PERSON_SPEC, TRANSACTION_SPEC } from '../src/legacy-bundle-fixtures'
import { type Kysely, sql } from 'kysely'

// board 0092 step 3 — register the contact + reconciliation composite types in the predicate_type
// registry: `person` (prenu), `company` (kagni) and `transaction` (pleji). The per-predicate
// data_schema rows (name/email/phone/iban/postal/vat_id/tax_number/represents/dated/booked) are seeded
// lazily by ensurePredicateSchemas on the next data call. No data re-sync (new types). aven-db untouched.

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const spec of [PERSON_SPEC, COMPANY_SPEC, TRANSACTION_SPEC]) {
		await sql`
			INSERT INTO predicate_type (type, spec)
			VALUES (${spec.type}, ${JSON.stringify(spec)}::jsonb)
			ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM predicate_type WHERE type IN ('person','company','transaction')`.execute(db)
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('person','company','transaction','represents','vat_id','tax_number','iban','postal','dated','booked'))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN ('person','company','transaction','represents','vat_id','tax_number','iban','postal','dated','booked')`.execute(db)
}
