import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { SiteBinding, SiteBindingDraft, SiteRuntimeStatus } from '@avenos/aven-hosting'
import type pg from 'pg'
import { type Queryable, withTransaction } from '../db.js'
import { AppError } from '../errors.js'

interface SiteRow {
	id: string
	name: string
	hostname: string
	repository: string
	source_ref: string
	artifact_ref: string
	runtime_status: SiteRuntimeStatus
	active_artifact_revision: string | null
	active_source_revision: string | null
	last_error: string | null
	verified_at: Date | string | null
	last_synced_at: Date | string | null
}

const iso = (value: Date | string | null): string | null =>
	value instanceof Date ? value.toISOString() : value
const branchOf = (ref: string): string => ref.replace(/^refs\/heads\//, '')

function siteOf(row: SiteRow): SiteBinding {
	return {
		id: row.id,
		name: row.name,
		hostname: row.hostname,
		repository: row.repository,
		sourceBranch: branchOf(row.source_ref),
		deploymentBranch: branchOf(row.artifact_ref),
		status: row.runtime_status,
		activeArtifactRevision: row.active_artifact_revision,
		activeSourceRevision: row.active_source_revision,
		lastError: row.last_error,
		verifiedAt: iso(row.verified_at),
		lastSyncedAt: iso(row.last_synced_at)
	}
}

export const hashVerificationToken = (token: string) =>
	createHash('sha256').update(token).digest('hex')

export class SiteBindingService {
	constructor(
		private pool: pg.Pool,
		private publicAddresses: { ipv4: string | null; ipv6: string[] } = { ipv4: null, ipv6: [] }
	) {}

	private async ownedEnvironment(connection: Queryable, userId: string, name: string) {
		const environment = await connection.query<{ id: string }>(
			`SELECT e.id FROM customer_environments e
			 JOIN names n ON n.name=e.name
			 WHERE e.name=$1 AND e.owner_user_id=$2 AND n.status='owned'
			 FOR UPDATE`,
			[name, userId]
		)
		const id = environment.rows[0]?.id
		if (!id) throw new AppError(404, 'NAME_NOT_FOUND', 'No owned Aven name has that value.')
		return id
	}

	private async repository(connection: Queryable, fullName: string, now: Date) {
		const result = await connection.query<{ id: string }>(
			`INSERT INTO site_repositories
			 (id,provider,repository_full_name,clone_url,created_at,updated_at)
			 VALUES ($1,'github',$2,$3,$4,$4)
			 ON CONFLICT (repository_full_name) DO UPDATE SET updated_at=EXCLUDED.updated_at
			 RETURNING id`,
			[randomUUID(), fullName, `https://github.com/${fullName}.git`, now]
		)
		const id = result.rows[0]?.id
		if (!id) throw new Error('repository upsert returned no id')
		return id
	}

	private async site(connection: Queryable, userId: string, id: string): Promise<SiteBinding> {
		const result = await connection.query<SiteRow>(
			`SELECT b.id,e.name,b.hostname,r.repository_full_name AS repository,
			        b.source_ref,b.artifact_ref,b.runtime_status,
			        b.active_artifact_revision,b.active_source_revision,b.last_error,
			        b.verified_at,b.last_synced_at
			 FROM static_site_bindings b
			 JOIN customer_environments e ON e.id=b.environment_id
			 JOIN site_repositories r ON r.id=b.repository_id
			 WHERE b.id=$1 AND e.owner_user_id=$2`,
			[id, userId]
		)
		const row = result.rows[0]
		if (!row) throw new AppError(404, 'SITE_NOT_FOUND', 'No site has that id.')
		return siteOf(row)
	}

	async listForUser(userId: string): Promise<SiteBinding[]> {
		const result = await this.pool.query<SiteRow>(
			`SELECT b.id,e.name,b.hostname,r.repository_full_name AS repository,
			        b.source_ref,b.artifact_ref,b.runtime_status,
			        b.active_artifact_revision,b.active_source_revision,b.last_error,
			        b.verified_at,b.last_synced_at
			 FROM static_site_bindings b
			 JOIN customer_environments e ON e.id=b.environment_id
			 JOIN site_repositories r ON r.id=b.repository_id
			 WHERE e.owner_user_id=$1 ORDER BY e.name,b.hostname`,
			[userId]
		)
		return result.rows.map(siteOf)
	}

	async create(userId: string, input: SiteBindingDraft) {
		return this.persist(userId, null, input)
	}

	async update(userId: string, id: string, input: SiteBindingDraft) {
		return this.persist(userId, id, input)
	}

	private async persist(userId: string, id: string | null, input: SiteBindingDraft) {
		const token = randomBytes(32).toString('base64url')
		const tokenHash = hashVerificationToken(token)
		try {
			const site = await withTransaction(this.pool, async (client) => {
				if (id) {
					const owned = await client.query(
						`SELECT 1 FROM static_site_bindings b
						 JOIN customer_environments e ON e.id=b.environment_id
						 WHERE b.id=$1 AND e.owner_user_id=$2 FOR UPDATE OF b`,
						[id, userId]
					)
					if (!owned.rowCount) throw new AppError(404, 'SITE_NOT_FOUND', 'No site has that id.')
				}
				const environmentId = await this.ownedEnvironment(client, userId, input.name)
				const now = new Date()
				const repositoryId = await this.repository(client, input.repository, now)
				const values = [
					environmentId,
					repositoryId,
					input.hostname,
					`refs/heads/${input.sourceBranch}`,
					`refs/heads/${input.deploymentBranch}`,
					tokenHash,
					now
				]
				let bindingId = id
				if (bindingId) {
					await client.query(
						`UPDATE static_site_bindings SET
						 environment_id=$1,repository_id=$2,hostname=$3,source_ref=$4,artifact_ref=$5,
						 verification_token_hash=$6,desired_status='active',runtime_status='awaiting_dns',
						 active_artifact_revision=NULL,active_source_revision=NULL,last_error=NULL,
						 verified_at=NULL,last_dns_check_at=NULL,last_synced_at=NULL,updated_at=$7
						 WHERE id=$8`,
						[...values, bindingId]
					)
				} else {
					bindingId = randomUUID()
					await client.query(
						`INSERT INTO static_site_bindings
						 (id,environment_id,repository_id,hostname,source_ref,artifact_ref,artifact_path,
						  verification_token_hash,desired_status,runtime_status,created_at,updated_at)
						 VALUES ($8,$1,$2,$3,$4,$5,'dist',$6,'active','awaiting_dns',$7,$7)`,
						[...values, bindingId]
					)
				}
				return this.site(client, userId, bindingId)
			})
			return {
				site,
				dns: {
					txtName: `_aven-site.${input.hostname}`,
					txtValue: token,
					hostname: input.hostname,
					...this.publicAddresses
				}
			}
		} catch (error) {
			if (error instanceof AppError) throw error
			if ((error as { code?: string }).code === '23505')
				throw new AppError(
					409,
					'SITE_BINDING_CONFLICT',
					'That hostname or deployment branch is already assigned.'
				)
			throw error
		}
	}

	async remove(userId: string, id: string): Promise<boolean> {
		const result = await this.pool.query(
			`DELETE FROM static_site_bindings b USING customer_environments e
			 WHERE b.environment_id=e.id AND e.owner_user_id=$1 AND b.id=$2`,
			[userId, id]
		)
		return (result.rowCount ?? 0) > 0
	}

	async directory() {
		const result = await this.pool.query(
			`SELECT b.id, b.hostname, r.repository_full_name, r.clone_url,
			        b.source_ref, b.artifact_ref, b.artifact_path,
			        b.verification_token_hash, b.verified_at,
			        (u.role='admin') AS owner_is_admin
			 FROM static_site_bindings b
			 JOIN site_repositories r ON r.id=b.repository_id
			 JOIN customer_environments e ON e.id=b.environment_id
			 JOIN names n ON n.name=e.name
			 JOIN "user" u ON u.id=e.owner_user_id
			 WHERE b.desired_status='active' AND n.status='owned'
			   AND (u.role='admin' OR (b.hostname <> 'aven.ceo' AND b.hostname NOT LIKE '%.aven.ceo'))
			 ORDER BY b.hostname`
		)
		return { bindings: result.rows }
	}

	async report(input: {
		id: string
		status: SiteRuntimeStatus
		error?: string | null
		artifactRevision?: string | null
		sourceRevision?: string | null
		dnsVerified?: boolean
	}) {
		const now = new Date()
		await this.pool.query(
			`UPDATE static_site_bindings SET runtime_status=$2, last_error=$3,
			 active_artifact_revision=COALESCE($4,active_artifact_revision),
			 active_source_revision=COALESCE($5,active_source_revision),
			 last_dns_check_at=$6,
			 verified_at=CASE WHEN $7 THEN $6 ELSE verified_at END,
			 last_synced_at=CASE WHEN $2='active' THEN $6 ELSE last_synced_at END,
			 updated_at=$6 WHERE id=$1`,
			[
				input.id,
				input.status,
				input.error?.slice(0, 1000) ?? null,
				input.artifactRevision ?? null,
				input.sourceRevision ?? null,
				now,
				input.dnsVerified ?? false
			]
		)
	}
}
