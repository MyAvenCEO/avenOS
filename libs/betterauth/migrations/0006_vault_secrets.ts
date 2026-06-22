import { type Kysely, sql } from 'kysely'

// E2EE secrets vault (board 0055). `vault` = one per user (the container + its passkey unlock
// wrap); `secret` = many per vault (the encrypted credentials). The server stores only
// ciphertext + wrapped key + salt + nonces — never the token, master DEK, KEK, or PRF.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('vault')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('credential_id', 'text', (c) => c.notNull())
		.addColumn('prf_salt', 'text', (c) => c.notNull())
		.addColumn('wrapped_master_key', 'text', (c) => c.notNull())
		.addColumn('wrap_nonce', 'text', (c) => c.notNull())
		.addColumn('alg', 'text', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// One vault per user.
	await db.schema
		.createIndex('vault_user_uidx')
		.ifNotExists()
		.on('vault')
		.column('user_id')
		.unique()
		.execute()

	await db.schema
		.createTable('secret')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('vault_id', 'text', (c) => c.notNull().references('vault.id').onDelete('cascade'))
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('kind', 'text', (c) => c.notNull())
		.addColumn('label', 'text')
		.addColumn('ciphertext', 'text', (c) => c.notNull())
		.addColumn('nonce', 'text', (c) => c.notNull())
		.addColumn('alg', 'text', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.addColumn('updated_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// One secret per (vault, kind) — lets the client upsert the fly_token by kind.
	await db.schema
		.createIndex('secret_vault_kind_uidx')
		.ifNotExists()
		.on('secret')
		.columns(['vault_id', 'kind'])
		.unique()
		.execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('secret').ifExists().execute()
	await db.schema.dropTable('vault').ifExists().execute()
}
