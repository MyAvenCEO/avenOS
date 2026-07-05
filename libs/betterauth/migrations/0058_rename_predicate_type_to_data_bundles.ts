import { type Kysely, sql } from 'kysely'

// board 0102 — bring the composite-type registry into the `data_` namespace. `predicate_type` was the odd
// one out (unprefixed + misnamed — it's not "a type of predicate", it's a BUNDLE recipe: which predicates
// cluster into a kind, plus how they read back flat). Renamed to `data_bundles` so the whole dynamic data
// brain shares one namespace: data_schema (predicates) · data_bundles (bundles) · data_value (predications)
// · data_queries / data_mutations (saved specs). Table-only rename; the `type` column (the bundle name)
// stays. Historical migrations that seed/strip `predicate_type` run BEFORE this on replay, so they're safe.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE IF EXISTS predicate_type RENAME TO data_bundles`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`ALTER TABLE IF EXISTS data_bundles RENAME TO predicate_type`.execute(db)
}
