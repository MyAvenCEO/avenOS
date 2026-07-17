import { type Kysely, sql } from 'kysely'

// board 0101 — the two registries for GLM-authored, AJV-validated query + mutation SPECS (named like the
// rest of the store). data_queries / data_mutations hold the JSON spec; the generic engine (queries.ts)
// runs them. GLM writes the spec, never raw SQL.

async function specTable(db: Kysely<unknown>, name: string): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS ${sql.raw(name)} (
			id text PRIMARY KEY,
			user_id text NOT NULL,
			name text NOT NULL,
			spec jsonb NOT NULL,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db)
	await sql`CREATE INDEX IF NOT EXISTS ${sql.raw(`${name}_user`)} ON ${sql.raw(name)} (user_id, name)`.execute(
		db
	)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await specTable(db, 'data_queries')
	await specTable(db, 'data_mutations')
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS data_queries`.execute(db)
	await sql`DROP TABLE IF EXISTS data_mutations`.execute(db)
}
