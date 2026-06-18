import { type Kysely, sql } from 'kysely'

// Persisted AI chat: one session per conversation, many messages. Per-user via
// ai_chat_session.user_id; messages reach a user only through their session. board 0051.

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('ai_chat_session')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('title', 'text', (c) => c.notNull().defaultTo(''))
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createTable('ai_message')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('session_id', 'text', (c) => c.notNull())
		.addColumn('role', 'text', (c) => c.notNull())
		.addColumn('content', 'text', (c) => c.notNull().defaultTo(''))
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	await db.schema
		.createIndex('ai_chat_session_user_updated_idx')
		.ifNotExists()
		.on('ai_chat_session')
		.columns(['user_id', 'updated_at'])
		.execute()

	await db.schema
		.createIndex('ai_message_session_created_idx')
		.ifNotExists()
		.on('ai_message')
		.columns(['session_id', 'created_at'])
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('ai_message').ifExists().execute()
	await db.schema.dropTable('ai_chat_session').ifExists().execute()
}
