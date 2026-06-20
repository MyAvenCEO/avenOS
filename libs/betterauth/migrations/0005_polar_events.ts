import { type Kysely, sql } from 'kysely'

// Append-only audit log of every verified Polar webhook event. The billing UI still reads live
// from the Polar API (the system of record); this table exists purely for audit / idempotency /
// replay. Keyed on the Standard Webhooks delivery id (the `webhook-id` header) so redeliveries of
// the same event are no-ops (ON CONFLICT DO NOTHING). board 0052.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('polar_event')
		.ifNotExists()
		.addColumn('event_id', 'text', (c) => c.primaryKey())
		.addColumn('type', 'text', (c) => c.notNull())
		.addColumn('external_id', 'text')
		.addColumn('payload', 'jsonb', (c) => c.notNull())
		.addColumn('received_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createIndex('polar_event_type_at_idx')
		.ifNotExists()
		.on('polar_event')
		.columns(['type', 'received_at'])
		.execute()

	await db.schema
		.createIndex('polar_event_external_at_idx')
		.ifNotExists()
		.on('polar_event')
		.columns(['external_id', 'received_at'])
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('polar_event').ifExists().execute()
}
