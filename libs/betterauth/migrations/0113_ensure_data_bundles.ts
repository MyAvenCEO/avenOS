import { type Kysely, sql } from 'kysely'

// board 0119j — ENSURE data_bundles exists. Forensics from the next-channel outage: the table was
// born as `predicate_type` (0014, runtime-import era) and 0058 renamed it with IF EXISTS — on a
// fresh catch-up the source table wasn't there, the rename silently no-opped, and data_bundles
// never materialized ("relation data_bundles does not exist" at 0073's saveType; now replay-
// guarded). Neither the runtime bootstrap nor any later migration creates it — so promotions and
// bundle authoring would fail at runtime. Shape mirrors dev exactly (PRIMARY KEY on type).

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS data_bundles (
			type text PRIMARY KEY,
			spec jsonb NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db)
}

export async function down(): Promise<void> {
	// ensure-only: never drop a table that may hold user bundle config.
}
