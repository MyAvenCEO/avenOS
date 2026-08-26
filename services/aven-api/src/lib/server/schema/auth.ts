// Identity module (Better Auth core tables + anti-abuse challenges).
// Owned by the server role; workers have no access to these tables.
import { bigint, boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	role: text('role').notNull().default('user'),
	image: text('image'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
})

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true })
})

export const proofOfWorkChallenges = pgTable(
	'proof_of_work_challenges',
	{
		id: text('id').primaryKey(),
		nonce: text('nonce').notNull(),
		purpose: text('purpose').notNull(),
		difficultyBits: integer('difficulty_bits').notNull(),
		expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
		usedAt: bigint('used_at', { mode: 'number' }),
		createdAt: bigint('created_at', { mode: 'number' }).notNull()
	},
	(t) => [
		index('proof_of_work_challenges_expiry_idx').on(t.expiresAt),
		index('proof_of_work_challenges_used_idx').on(t.usedAt)
	]
)
