import { type Kysely, sql } from 'kysely'

// Content-addressed raw-artifact store (board 0089) — the original file/photo bytes for ANY
// ingesting skill, keyed by sha256. `bytea` behind the abstracted ArtifactStore interface; only the
// hash enters the predication graph. mainnet Postgres, NOT the spark fs / aven-db CRDT.
// See [[avendb-crdt-vs-mainnet-postgres]].

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('artifact')
		.ifNotExists()
		.addColumn('sha256', 'text', (c) => c.primaryKey())
		.addColumn('bytes', sql`bytea`, (c) => c.notNull())
		.addColumn('mime', 'text', (c) => c.notNull())
		.addColumn('size', 'integer', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('artifact').ifExists().execute()
}
