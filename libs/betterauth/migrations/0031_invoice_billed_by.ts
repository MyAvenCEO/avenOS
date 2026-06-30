import { INVOICE_SPEC } from '@avenos/aven-ontology'
import { type Kysely, sql } from 'kysely'

// board 0093 — re-seed the invoice composite spec so it carries `billed_by` ≡ janta.x4 (the vendor
// company ref), which `enrichAddressbook` sets to link an invoice to its matched/created company.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${INVOICE_SPEC.type}, ${JSON.stringify(INVOICE_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (additive place); no auto-restore.
}
