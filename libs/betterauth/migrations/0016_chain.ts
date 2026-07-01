import { type Kysely, sql } from 'kysely'

// Internal chain (board 0088). A fake-but-realistic on-Postgres token ledger for aEUR
// (avenEURO), prefixed `chain_*` and modelled close to a real chain so it can be swapped
// for one plug-and-play later. Money lives in INTEGER MINOR UNITS in `bigint` columns.
//
//   chain_account  — one address per user (derived from the user id by the Signer).
//   chain_token    — the aEUR token: admin-only mint, supply grows on mint (≈ unlimited).
//   chain_tx       — the ledger: every mint/transfer, SIGNED and HASH-CHAINED (prev_hash).
//   chain_contract — the aEUR "contract" row (generic kind + json state) for the executor.
export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('chain_account')
		.ifNotExists()
		.addColumn('address', 'text', (c) => c.primaryKey())
		.addColumn('user_id', 'text', (c) => c.notNull())
		.addColumn('pubkey', 'text', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// One account per user.
	await db.schema
		.createIndex('chain_account_user_uidx')
		.ifNotExists()
		.on('chain_account')
		.column('user_id')
		.unique()
		.execute()

	await db.schema
		.createTable('chain_token')
		.ifNotExists()
		.addColumn('symbol', 'text', (c) => c.primaryKey())
		.addColumn('name', 'text', (c) => c.notNull())
		.addColumn('decimals', 'integer', (c) => c.notNull().defaultTo(2))
		.addColumn('minter_address', 'text')
		.addColumn('total_supply', 'bigint', (c) => c.notNull().defaultTo(0))
		.execute()

	await db.schema
		.createTable('chain_tx')
		.ifNotExists()
		.addColumn('id', 'text', (c) => c.primaryKey())
		.addColumn('seq', 'bigint', (c) => c.notNull())
		.addColumn('kind', 'text', (c) => c.notNull())
		.addColumn('token', 'text', (c) => c.notNull())
		.addColumn('from_address', 'text')
		.addColumn('to_address', 'text', (c) => c.notNull())
		.addColumn('amount', 'bigint', (c) => c.notNull())
		.addColumn('caller', 'text', (c) => c.notNull())
		.addColumn('nonce', 'text', (c) => c.notNull())
		.addColumn('signature', 'text', (c) => c.notNull())
		.addColumn('prev_hash', 'text', (c) => c.notNull())
		.addColumn('hash', 'text', (c) => c.notNull())
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// Monotonic ledger order; the hash chain links rows in this order.
	await db.schema
		.createIndex('chain_tx_seq_uidx')
		.ifNotExists()
		.on('chain_tx')
		.column('seq')
		.unique()
		.execute()
	await db.schema
		.createIndex('chain_tx_to_idx')
		.ifNotExists()
		.on('chain_tx')
		.column('to_address')
		.execute()
	await db.schema
		.createIndex('chain_tx_from_idx')
		.ifNotExists()
		.on('chain_tx')
		.column('from_address')
		.execute()

	await db.schema
		.createTable('chain_contract')
		.ifNotExists()
		.addColumn('address', 'text', (c) => c.primaryKey())
		.addColumn('kind', 'text', (c) => c.notNull())
		.addColumn('state', 'jsonb', (c) => c.notNull().defaultTo(sql`'{}'::jsonb`))
		.addColumn('created_at', sql`timestamptz`, (c) => c.notNull().defaultTo(sql`now()`))
		.execute()

	// Seed the aEUR token (minter claimed by the first admin that mints) and its contract row.
	await sql`
		INSERT INTO chain_token (symbol, name, decimals, minter_address, total_supply)
		VALUES ('aEUR', 'avenEURO', 2, NULL, 0)
		ON CONFLICT (symbol) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO chain_contract (address, kind, state)
		VALUES ('0xaeur00000000000000000000000000000000aeur', 'aeur-token', '{"symbol":"aEUR"}'::jsonb)
		ON CONFLICT (address) DO NOTHING
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await db.schema.dropTable('chain_tx').ifExists().execute()
	await db.schema.dropTable('chain_contract').ifExists().execute()
	await db.schema.dropTable('chain_token').ifExists().execute()
	await db.schema.dropTable('chain_account').ifExists().execute()
}
