import { type Kysely, sql } from 'kysely'

// Inbound email from the Postmark inbound webhook (POST /webhooks/inbox/mail). Headline fields for
// querying + the full raw MIME (`raw_email`) + the entire Postmark JSON (`payload`). Deduped on
// `message_id`. Idempotent. board 0060.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('inbound_email')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('message_id', 'text')
		.addColumn('from_email', 'text')
		.addColumn('from_name', 'text')
		.addColumn('to_email', 'text')
		.addColumn('subject', 'text')
		.addColumn('text_body', 'text')
		.addColumn('html_body', 'text')
		.addColumn('mailbox_hash', 'text')
		.addColumn('raw_email', 'text')
		.addColumn('payload', 'jsonb', (c) => c.notNull())
		.addColumn('received_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// Dedupe Postmark retries on the message id (NULLs stay distinct, which is fine).
	await db.schema
		.createIndex('inbound_email_message_id_uidx')
		.ifNotExists()
		.on('inbound_email')
		.column('message_id')
		.unique()
		.execute()

	await db.schema
		.createIndex('inbound_email_received_idx')
		.ifNotExists()
		.on('inbound_email')
		.column('received_at')
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('inbound_email').ifExists().execute()
}
