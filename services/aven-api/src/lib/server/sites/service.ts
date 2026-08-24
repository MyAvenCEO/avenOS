import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { withTransaction } from '../db.js'
import { AppError } from '../errors.js'

export type SiteRuntimeStatus = 'awaiting_dns' | 'syncing' | 'active' | 'dns_invalid' | 'failed'

export interface SiteBindingInput {
	name: string
	hostname: string
	repository: string
	sourceBranch: string
	deploymentBranch: string
}

export const hashVerificationToken = (token: string) =>
	createHash('sha256').update(token).digest('hex')

export class SiteBindingService {
	constructor(private pool: pg.Pool) {}

	async listForUser(userId: string) {
		const result = await this.pool.query(
			`SELECT e.name, b.hostname, r.repository_full_name AS repository,
			        b.source_ref, b.artifact_ref, b.runtime_status,
			        b.active_artifact_revision, b.active_source_revision,
			        b.last_error, b.verified_at, b.last_synced_at
			 FROM static_site_bindings b
			 JOIN customer_environments e ON e.id=b.environment_id
			 JOIN site_repositories r ON r.id=b.repository_id
			 WHERE e.owner_user_id=$1 ORDER BY e.name`,
			[userId]
		)
		return result.rows
	}

	async configure(userId: string, input: SiteBindingInput) {
		const token = randomBytes(32).toString('base64url')
		const tokenHash = hashVerificationToken(token)
		try {
			const binding = await withTransaction(this.pool, async (client) => {
				const environment = await client.query<{ id: string }>(
					`SELECT e.id FROM customer_environments e
					 JOIN names n ON n.name=e.name
					 WHERE e.name=$1 AND e.owner_user_id=$2 AND n.status='owned'
					 FOR UPDATE`,
					[input.name, userId]
				)
				const environmentId = environment.rows[0]?.id
				if (!environmentId)
					throw new AppError(404, 'NAME_NOT_FOUND', 'No owned Aven name has that value.')
				const now = new Date()
				const repositoryId = randomUUID()
				const cloneUrl = `https://github.com/${input.repository}.git`
				const repo = await client.query<{ id: string }>(
					`INSERT INTO site_repositories
					 (id,provider,repository_full_name,clone_url,created_at,updated_at)
					 VALUES ($1,'github',$2,$3,$4,$4)
					 ON CONFLICT (repository_full_name) DO UPDATE SET updated_at=EXCLUDED.updated_at
					 RETURNING id`,
					[repositoryId, input.repository, cloneUrl, now]
				)
				const persistedRepositoryId = repo.rows[0]?.id
				if (!persistedRepositoryId) throw new Error('repository upsert returned no id')
				const result = await client.query(
					`INSERT INTO static_site_bindings
					 (id,environment_id,repository_id,hostname,source_ref,artifact_ref,artifact_path,
					  verification_token_hash,desired_status,runtime_status,created_at,updated_at)
					 VALUES ($1,$2,$3,$4,$5,$6,'dist',$7,'active','awaiting_dns',$8,$8)
					 ON CONFLICT (environment_id) DO UPDATE SET
					  repository_id=EXCLUDED.repository_id, hostname=EXCLUDED.hostname,
					  source_ref=EXCLUDED.source_ref, artifact_ref=EXCLUDED.artifact_ref,
					  verification_token_hash=EXCLUDED.verification_token_hash,
					  desired_status='active', runtime_status='awaiting_dns',
					  active_artifact_revision=NULL, active_source_revision=NULL,
					  last_error=NULL, verified_at=NULL, last_dns_check_at=NULL,
					  last_synced_at=NULL, updated_at=EXCLUDED.updated_at
					 RETURNING id,hostname,runtime_status`,
					[
						randomUUID(),
						environmentId,
						persistedRepositoryId,
						input.hostname,
						`refs/heads/${input.sourceBranch}`,
						`refs/heads/${input.deploymentBranch}`,
						tokenHash,
						now
					]
				)
				return result.rows[0]
			})
			return {
				...binding,
				dns: {
					txtName: `_aven-site.${input.hostname}`,
					txtValue: token,
					hostname: input.hostname
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

	async remove(userId: string, name: string): Promise<boolean> {
		const result = await this.pool.query(
			`DELETE FROM static_site_bindings b USING customer_environments e
			 WHERE b.environment_id=e.id AND e.owner_user_id=$1 AND e.name=$2`,
			[userId, name]
		)
		return (result.rowCount ?? 0) > 0
	}

	async directory() {
		const result = await this.pool.query(
			`SELECT b.id, b.hostname, r.repository_full_name, r.clone_url,
			        b.source_ref, b.artifact_ref, b.artifact_path,
			        b.verification_token_hash, b.verified_at
			 FROM static_site_bindings b
			 JOIN site_repositories r ON r.id=b.repository_id
			 JOIN customer_environments e ON e.id=b.environment_id
			 JOIN names n ON n.name=e.name
			 WHERE b.desired_status='active' AND n.status='owned'
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
