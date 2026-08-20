import { sql } from 'drizzle-orm'
import {
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { names } from './names.js'

export const customerEnvironments = pgTable(
	'customer_environments',
	{
		id: text('id').primaryKey(),
		ownerUserId: text('owner_user_id')
			.notNull()
			.references(() => user.id),
		name: text('name')
			.notNull()
			.unique()
			.references(() => names.name),
		databaseName: text('database_name').notNull().unique(),
		ownerRole: text('owner_role').notNull().unique(),
		stackName: text('stack_name').notNull().unique(),
		contractVersion: integer('contract_version').notNull().default(1),
		effectiveConfig: jsonb('effective_config').notNull().default({}),
		status: text('status').notNull(),
		lastOperation: text('last_operation'),
		lastErrorCode: text('last_error_code'),
		lastErrorMessage: text('last_error_message'),
		queuedAt: timestamp('queued_at', { withTimezone: true }).notNull(),
		provisioningAt: timestamp('provisioning_at', { withTimezone: true }),
		readyAt: timestamp('ready_at', { withTimezone: true }),
		suspendedAt: timestamp('suspended_at', { withTimezone: true }),
		failedAt: timestamp('failed_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(table) => [
		index('customer_environments_owner_idx').on(table.ownerUserId),
		index('customer_environments_status_idx').on(table.status)
	]
)

export const customerEnvironmentJobs = pgTable(
	'customer_environment_jobs',
	{
		id: text('id').primaryKey(),
		environmentId: text('environment_id')
			.notNull()
			.references(() => customerEnvironments.id),
		operation: text('operation').notNull(),
		status: text('status').notNull(),
		attempt: integer('attempt').notNull().default(0),
		availableAt: timestamp('available_at', { withTimezone: true }).notNull(),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message')
	},
	(table) => [
		index('customer_environment_jobs_claim_idx').on(table.status, table.availableAt),
		uniqueIndex('customer_environment_jobs_one_unfinished')
			.on(table.environmentId)
			.where(sql`${table.status} IN ('queued','running')`)
	]
)

export const customerEnvironmentLogs = pgTable(
	'customer_environment_logs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: text('job_id')
			.notNull()
			.references(() => customerEnvironmentJobs.id),
		sequence: integer('sequence').notNull(),
		level: text('level').notNull(),
		message: text('message').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(table) => [
		uniqueIndex('customer_environment_logs_job_sequence_unique').on(table.jobId, table.sequence)
	]
)
