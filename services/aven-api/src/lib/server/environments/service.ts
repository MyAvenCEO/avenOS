import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { writeAudit } from '../audit.js'
import { type Queryable, withTransaction } from '../db.js'
import { AppError } from '../errors.js'
import { environmentNames } from './naming.js'
import { CURRENT_ARTIFACT_STORE_SCHEMA_VERSION } from './provisioning.js'

export class EnvironmentService {
	constructor(private pool: pg.Pool) {}

	async enqueueProvision(
		connection: Queryable,
		input: { userId: string; name: string }
	): Promise<string> {
		const names = environmentNames(input.name)
		const existing = (
			await connection.query(
				'SELECT id,owner_user_id FROM customer_environments WHERE name=$1 FOR UPDATE',
				[names.name]
			)
		).rows[0] as { id: string; owner_user_id: string } | undefined
		if (existing && existing.owner_user_id !== input.userId)
			throw new Error('Customer environment owner conflict.')

		const environmentId = existing?.id ?? randomUUID()
		const artifactScopeId = environmentId
		const now = new Date()
		if (!existing) {
			const effectiveConfig = {
				contractVersion: 2,
				name: names.name,
				databaseName: names.databaseName,
				stackName: names.stackName,
				artifactStore: { schemaVersion: 1, scopeId: artifactScopeId },
				applications: []
			}
			await connection.query(
				`INSERT INTO customer_environments
				  (id,owner_user_id,name,database_name,artifact_scope_id,artifact_store_status,owner_role,stack_name,contract_version,effective_config,status,last_operation,queued_at,updated_at)
				 VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,2,$8,'queued','provision',$9,$9)`,
				[
					environmentId,
					input.userId,
					names.name,
					names.databaseName,
					artifactScopeId,
					names.ownerRole,
					names.stackName,
					JSON.stringify(effectiveConfig),
					now
				]
			)
		}
		await this.enqueueJob(connection, environmentId, 'provision', now)
		await writeAudit(connection, {
			eventType: 'environment.provision_queued',
			targetUserId: input.userId,
			metadata: { environmentId, name: names.name }
		})
		return environmentId
	}

	async artifactTargetForUser(userId: string): Promise<{
		environmentId: string
		databaseName: string
		scopeId: string
	}> {
		const rows = (
			await this.pool.query(
				`SELECT environment.id,environment.database_name,environment.artifact_scope_id,environment.artifact_store_schema_version,
				        environment.artifact_store_status,environment.status
				 FROM customer_environments environment
				 JOIN names name_record ON name_record.name=environment.name
				 WHERE environment.owner_user_id=$1 AND name_record.status='owned'
				 ORDER BY environment.id LIMIT 2`,
				[userId]
			)
		).rows as Array<{
			id: string
			database_name: string
			artifact_scope_id: string
			artifact_store_status: string
			artifact_store_schema_version: number
			status: string
		}>
		const [environment, extraEnvironment] = rows
		if (!environment) {
			throw new AppError(403, 'NAME_REQUIRED', 'Purchase a name before storing artifacts.')
		}
		if (extraEnvironment) {
			throw new AppError(
				409,
				'ARTIFACT_ENVIRONMENT_AMBIGUOUS',
				'Select a customer environment before storing artifacts.'
			)
		}
		if (
			environment.status !== 'ready' ||
			environment.artifact_store_status !== 'ready' ||
			environment.artifact_store_schema_version < CURRENT_ARTIFACT_STORE_SCHEMA_VERSION
		) {
			throw new AppError(
				409,
				'ARTIFACT_ENVIRONMENT_NOT_READY',
				'The customer environment is not ready for artifact storage.'
			)
		}
		return {
			environmentId: environment.id,
			databaseName: environment.database_name,
			scopeId: environment.artifact_scope_id
		}
	}

	async enqueueSuspension(
		connection: Queryable,
		input: { userId: string; name: string }
	): Promise<void> {
		const row = (
			await connection.query(
				'SELECT id FROM customer_environments WHERE name=$1 AND owner_user_id=$2 FOR UPDATE',
				[environmentNames(input.name).name, input.userId]
			)
		).rows[0] as { id: string } | undefined
		if (!row) return
		const now = new Date()
		await connection.query(
			"UPDATE customer_environments SET status='queued',last_operation='suspend',queued_at=$1,updated_at=$1 WHERE id=$2",
			[now, row.id]
		)
		const replaced = await connection.query(
			"UPDATE customer_environment_jobs SET operation='suspend',attempt=0,available_at=$1,error_code=NULL,error_message=NULL WHERE environment_id=$2 AND status='queued'",
			[now, row.id]
		)
		if (replaced.rowCount === 0) await this.enqueueJob(connection, row.id, 'suspend', now)
		await writeAudit(connection, {
			eventType: 'environment.suspend_queued',
			targetUserId: input.userId,
			metadata: { environmentId: row.id, name: input.name }
		})
	}

	private async enqueueJob(
		connection: Queryable,
		environmentId: string,
		operation: 'provision' | 'suspend',
		now: Date
	): Promise<void> {
		await connection.query(
			`INSERT INTO customer_environment_jobs (id,environment_id,operation,status,attempt,available_at,created_at)
       VALUES ($1,$2,$3,'queued',0,$4,$4) ON CONFLICT DO NOTHING`,
			[randomUUID(), environmentId, operation, now]
		)
	}

	async status(name: string) {
		const row = (
			await this.pool.query(
				`SELECT id,name,database_name,artifact_scope_id,artifact_store_status,artifact_store_schema_version,owner_role,stack_name,contract_version,status,last_operation,
              last_error_code,last_error_message,queued_at,provisioning_at,ready_at,suspended_at,failed_at,updated_at
       FROM customer_environments WHERE name=$1`,
				[environmentNames(name).name]
			)
		).rows[0]
		if (!row) throw new AppError(404, 'ENVIRONMENT_NOT_FOUND', 'Environment not found.')
		return row
	}

	async retry(name: string): Promise<void> {
		await withTransaction(this.pool, async (client) => {
			const row = (
				await client.query(
					'SELECT id,status,last_operation FROM customer_environments WHERE name=$1 FOR UPDATE',
					[environmentNames(name).name]
				)
			).rows[0] as
				| { id: string; status: string; last_operation: 'provision' | 'suspend' | null }
				| undefined
			if (!row) throw new AppError(404, 'ENVIRONMENT_NOT_FOUND', 'Environment not found.')
			if (row.status !== 'failed')
				throw new AppError(
					409,
					'ENVIRONMENT_STATE_CONFLICT',
					'Only a failed environment can be retried.'
				)
			const operation = row.last_operation ?? 'provision'
			const now = new Date()
			await client.query(
				"UPDATE customer_environments SET status='queued',queued_at=$1,updated_at=$1,last_error_code=NULL,last_error_message=NULL WHERE id=$2",
				[now, row.id]
			)
			await this.enqueueJob(client, row.id, operation, now)
			await writeAudit(client, {
				eventType: 'environment.retried',
				metadata: { environmentId: row.id, name, operation }
			})
		})
	}

	async reconcile(): Promise<number> {
		const result = await this.pool.query(
			`UPDATE customer_environment_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=now()
       WHERE status='running' AND lease_expires_at < now()`
		)
		return result.rowCount ?? 0
	}
}
