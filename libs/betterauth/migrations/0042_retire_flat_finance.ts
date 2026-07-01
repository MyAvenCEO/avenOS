import { TRANSACTION_SPEC } from '@avenos/aven-ontology'
import { type Kysely, sql } from 'kysely'

// board 0098 — the finance verticals are now on Lojban predications: a bank transaction is
// `transaction`≡pleji + `dated`/`value_dated`≡detri + `balance`≡klani + currency/FX `identifier`≡tcita
// + `booked`≡cmima + `matched`≡mapti (reconciliation). Re-seed the consolidated TRANSACTION_SPEC and
// RETIRE the last legacy flat finance schemas — `tx` (superseded by `transaction`), `match` (by
// `matched`), `booking` (the P&L is computed from transactions grouped by their `booked` SKR04 account,
// single-entry). data_value first for the FK, then the orphaned data_schema rows. Fresh branch = no-op.
// aven-db CRDT untouched.

const RETIRED = ['tx', 'match', 'booking']

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO predicate_type (type, spec)
		VALUES (${TRANSACTION_SPEC.type}, ${JSON.stringify(TRANSACTION_SPEC)}::jsonb)
		ON CONFLICT (type) DO UPDATE SET spec = EXCLUDED.spec, updated_at = now()
	`.execute(db)
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN (${sql.join(RETIRED)}))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name IN (${sql.join(RETIRED)})`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only — the predication types supersede the flat finance schemas.
}
