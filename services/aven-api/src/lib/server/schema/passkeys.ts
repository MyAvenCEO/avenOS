import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth.js'

export const passkey = pgTable(
	'passkey',
	{
		id: text('id').primaryKey(),
		name: text('name'),
		publicKey: text('public_key').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		credentialID: text('credential_id').notNull(),
		counter: integer('counter').notNull(),
		deviceType: text('device_type').notNull(),
		backedUp: boolean('backed_up').notNull(),
		transports: text('transports'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		aaguid: text('aaguid'),
		prfEnabled: boolean('prf_enabled').notNull().default(false)
	},
	(table) => [
		uniqueIndex('passkey_credential_id_unique').on(table.credentialID),
		index('passkey_user_id_idx').on(table.userId)
	]
)

// Reusable after purchase and invalidated once passkey enrollment is complete.
// Only a hash is persisted.
export const setupLinks = pgTable('setup_links', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	tokenHash: text('token_hash').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	lastUsedAt: timestamp('last_used_at', { withTimezone: true })
})
