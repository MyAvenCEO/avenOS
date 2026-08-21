// Short-lived RFC 8628 grants used to hand a session to a native client.
// The device code is consumed atomically when it becomes a bearer session.
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { user } from './auth.js'

export const deviceCode = pgTable(
	'device_code',
	{
		id: text('id').primaryKey(),
		deviceCode: text('device_code').notNull(),
		userCode: text('user_code').notNull(),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		status: text('status').notNull(),
		lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
		pollingInterval: integer('polling_interval'),
		clientId: text('client_id'),
		scope: text('scope')
	},
	(t) => [
		uniqueIndex('device_code_device_code_unique').on(t.deviceCode),
		uniqueIndex('device_code_user_code_unique').on(t.userCode),
		index('device_code_expires_idx').on(t.expiresAt),
		index('device_code_user_idx').on(t.userId)
	]
)
