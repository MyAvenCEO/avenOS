import { type Kysely, sql } from 'kysely'

// Persisted skill RUN traces (board 0089) — the FlowRun event-log produced by the generic runner,
// per user. Lets a run be inspected after the fact (and, later, the Runs UI read real runs instead
// of fixtures). mainnet Postgres.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('flow_run')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('flow_id', 'text', (c) => c.notNull())
		.addColumn('label', 'text', (c) => c.notNull())
		.addColumn('status', 'text', (c) => c.notNull())
		.addColumn('trace', 'jsonb', (c) => c.notNull())
		.addColumn('started_at', sql`timestamptz`)
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('flow_run').ifExists().execute()
}
