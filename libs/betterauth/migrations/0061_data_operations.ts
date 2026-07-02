import { type Kysely, sql } from 'kysely'

// board 0104 — merge the two operation registries into ONE `data_operations` table. A query and a mutation
// are one species (an OPERATION — one reads, one writes), so they share a table with a `kind` discriminator.
// `derived_from` names the bundle an op was compiled from (NULL = hand/GLM-authored); a derived op is a
// GLOBAL template (user_id NULL) while a GLM-authored one stays user-scoped. Bundles do NOT live here —
// they are the definition layer (a NOUN) that COMPILES to these ops (the verbs). Existing 0101 specs
// (incl. the live m-i-ate-2-bananas mutation) are carried over verbatim, then the old tables are dropped.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS data_operations (
			id text PRIMARY KEY,
			user_id text,
			name text NOT NULL,
			kind text NOT NULL CHECK (kind IN ('query', 'mutation')),
			spec jsonb NOT NULL,
			derived_from text,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db)
	await sql`CREATE INDEX IF NOT EXISTS data_operations_user ON data_operations (user_id, kind, name)`.execute(
		db
	)

	// carry over the 0101 rows with their kind, verbatim (id kept so nothing re-authors).
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		SELECT id, user_id, name, 'query', spec, created_at, updated_at FROM data_queries
		ON CONFLICT (id) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		SELECT id, user_id, name, 'mutation', spec, created_at, updated_at FROM data_mutations
		ON CONFLICT (id) DO NOTHING
	`.execute(db)

	await sql`DROP TABLE IF EXISTS data_queries`.execute(db)
	await sql`DROP TABLE IF EXISTS data_mutations`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	// forward-only (the merge is one-directional); recreate empty legacy tables so a rollback doesn't 500.
	await sql`CREATE TABLE IF NOT EXISTS data_queries (id text PRIMARY KEY, user_id text, name text, spec jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`.execute(
		db
	)
	await sql`CREATE TABLE IF NOT EXISTS data_mutations (id text PRIMARY KEY, user_id text, name text, spec jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`.execute(
		db
	)
	await sql`DROP TABLE IF EXISTS data_operations`.execute(db)
}
