import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { customerEnvironments } from './environments.js'

export const siteRepositories = pgTable(
	'site_repositories',
	{
		id: text('id').primaryKey(),
		provider: text('provider').notNull().default('github'),
		repositoryFullName: text('repository_full_name').notNull().unique(),
		cloneUrl: text('clone_url').notNull().unique(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(table) => [
		check('site_repositories_github_only', sql`${table.provider} = 'github'`),
		check(
			'site_repositories_clone_url_derived',
			sql`${table.cloneUrl} = 'https://github.com/' || ${table.repositoryFullName} || '.git'`
		)
	]
)

export const staticSiteBindings = pgTable(
	'static_site_bindings',
	{
		id: text('id').primaryKey(),
		environmentId: text('environment_id')
			.notNull()
			.unique()
			.references(() => customerEnvironments.id, { onDelete: 'cascade' }),
		repositoryId: text('repository_id')
			.notNull()
			.references(() => siteRepositories.id),
		hostname: text('hostname').notNull().unique(),
		sourceRef: text('source_ref').notNull(),
		artifactRef: text('artifact_ref').notNull(),
		artifactPath: text('artifact_path').notNull().default('dist'),
		verificationTokenHash: text('verification_token_hash').notNull(),
		desiredStatus: text('desired_status').notNull().default('active'),
		runtimeStatus: text('runtime_status').notNull().default('awaiting_dns'),
		activeArtifactRevision: text('active_artifact_revision'),
		activeSourceRevision: text('active_source_revision'),
		lastError: text('last_error'),
		verifiedAt: timestamp('verified_at', { withTimezone: true }),
		lastDnsCheckAt: timestamp('last_dns_check_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(table) => [
		check('static_site_bindings_artifact_path_dist', sql`${table.artifactPath} = 'dist'`),
		check(
			'static_site_bindings_deployment_ref',
			sql`${table.artifactRef} LIKE 'refs/heads/deploy/%'`
		),
		check(
			'static_site_bindings_token_hash',
			sql`${table.verificationTokenHash} ~ '^[0-9a-f]{64}$'`
		),
		check(
			'static_site_bindings_desired_status',
			sql`${table.desiredStatus} IN ('active','suspended')`
		),
		check(
			'static_site_bindings_runtime_status',
			sql`${table.runtimeStatus} IN ('awaiting_dns','syncing','active','dns_invalid','failed')`
		),
		uniqueIndex('static_site_bindings_artifact_ref_unique').on(
			table.repositoryId,
			table.artifactRef
		),
		index('static_site_bindings_status_idx').on(table.desiredStatus, table.runtimeStatus)
	]
)
