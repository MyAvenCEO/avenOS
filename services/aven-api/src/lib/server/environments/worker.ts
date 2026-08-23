import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type pino from 'pino'
import { sanitizeError } from '../../validation.js'
import { writeAudit } from '../audit.js'
import type { EnvironmentWorkerConfig } from '../config.js'
import { withTransaction } from '../db.js'
import { provisionEnvironmentDatabase, suspendEnvironmentDatabase } from './provisioning.js'

interface ClaimedJob {
	id: string
	environment_id: string
	operation: 'provision' | 'suspend'
	attempt: number
	database_name: string
	owner_role: string
	artifact_scope_id: string
}

export class EnvironmentWorker {
	private timer?: NodeJS.Timeout
	private running = false
	private readonly instanceId = randomUUID()
	private readonly started = new Date()

	constructor(
		private pool: pg.Pool,
		private config: EnvironmentWorkerConfig,
		private logger: pino.Logger
	) {}

	start(): void {
		void this.initialize().catch((error) => {
			this.logger.error({ err: sanitizeError(error) }, 'environment worker initialization failed')
		})
	}

	private async initialize(): Promise<void> {
		await this.recoverExpired()
		await this.enqueueArtifactStoreUpgrades()
		this.timer = setInterval(() => {
			void this.tick()
		}, this.config.ENVIRONMENT_WORKER_POLL_INTERVAL_MS)
		this.timer.unref()
		await this.tick()
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer)
	}

	async recoverExpired(): Promise<void> {
		await this.pool.query(
			"UPDATE customer_environment_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=now() WHERE status='running' AND lease_expires_at < now()"
		)
	}

	async enqueueArtifactStoreUpgrades(): Promise<number> {
		if (
			!this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL ||
			!this.config.ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN ||
			!this.config.ARTIFACT_STORE_RUNTIME_ROLE ||
			!this.config.ARTIFACT_STORE_RUNTIME_PASSWORD
		) {
			return 0
		}
		const environments = (
			await this.pool.query(
				`SELECT environment.id
         FROM customer_environments environment
         WHERE environment.status='ready' AND environment.artifact_store_status='pending'
           AND NOT EXISTS (
             SELECT 1 FROM customer_environment_jobs job
             WHERE job.environment_id=environment.id AND job.status IN ('queued','running')
           )`
			)
		).rows as Array<{ id: string }>
		let queued = 0
		for (const environment of environments) {
			const result = await this.pool.query(
				`INSERT INTO customer_environment_jobs
           (id,environment_id,operation,status,attempt,available_at,created_at)
         VALUES ($1,$2,'provision','queued',0,now(),now())
         ON CONFLICT DO NOTHING`,
				[randomUUID(), environment.id]
			)
			queued += result.rowCount ?? 0
			if (result.rowCount === 1) {
				await writeAudit(this.pool, {
					eventType: 'environment.artifact_store_upgrade_queued',
					metadata: { environmentId: environment.id }
				})
			}
		}
		return queued
	}

	private async heartbeat(): Promise<void> {
		await this.pool.query(
			`INSERT INTO worker_heartbeats(worker_name,instance_id,version,started_at,last_heartbeat_at,metadata)
       VALUES('environment-worker',$1,$2,$3,now(),'{"concurrency":1}'::jsonb)
       ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,version=EXCLUDED.version,last_heartbeat_at=EXCLUDED.last_heartbeat_at,metadata=EXCLUDED.metadata`,
			[this.instanceId, this.config.APPLICATION_VERSION, this.started]
		)
	}

	async tick(): Promise<void> {
		if (this.running) return
		this.running = true
		try {
			await this.heartbeat()
			const job = await this.claim()
			if (job) await this.run(job)
		} catch (error) {
			this.logger.error({ err: sanitizeError(error) }, 'environment worker tick failed')
		} finally {
			this.running = false
		}
	}

	private async claim(): Promise<ClaimedJob | null> {
		return withTransaction(this.pool, async (client) => {
			const job = (
				await client.query<ClaimedJob>(
					`SELECT job.id,job.environment_id,job.operation,job.attempt,environment.database_name,environment.owner_role,environment.artifact_scope_id
         FROM customer_environment_jobs job
         JOIN customer_environments environment ON environment.id=job.environment_id
         WHERE job.status='queued' AND job.available_at <= now()
         ORDER BY job.created_at LIMIT 1 FOR UPDATE OF job SKIP LOCKED`
				)
			).rows[0]
			if (!job) return null
			const expires = new Date(Date.now() + this.config.ENVIRONMENT_WORKER_LEASE_SECONDS * 1000)
			await client.query(
				"UPDATE customer_environment_jobs SET status='running',attempt=attempt+1,lease_owner=$1,lease_expires_at=$2,started_at=COALESCE(started_at,now()) WHERE id=$3",
				[this.instanceId, expires, job.id]
			)
			await client.query(
				"UPDATE customer_environments SET status='provisioning',last_operation=$1,provisioning_at=now(),updated_at=now() WHERE id=$2",
				[job.operation, job.environment_id]
			)
			await writeAudit(client, {
				eventType: `environment.${job.operation}_started`,
				metadata: { environmentId: job.environment_id, jobId: job.id }
			})
			return job
		})
	}

	private async addLog(jobId: string, level: string, message: string): Promise<void> {
		await this.pool.query(
			`INSERT INTO customer_environment_logs(job_id,sequence,level,message,created_at)
       VALUES ($1,(SELECT COALESCE(MAX(sequence),0)+1 FROM customer_environment_logs WHERE job_id=$1),$2,$3,now())`,
			[jobId, level, sanitizeError(message)]
		)
	}

	private async run(job: ClaimedJob): Promise<void> {
		const renew = setInterval(
			() => {
				void this.pool.query(
					"UPDATE customer_environment_jobs SET lease_expires_at=$1 WHERE id=$2 AND status='running' AND lease_owner=$3",
					[
						new Date(Date.now() + this.config.ENVIRONMENT_WORKER_LEASE_SECONDS * 1000),
						job.id,
						this.instanceId
					]
				)
			},
			Math.max(1_000, this.config.ENVIRONMENT_WORKER_HEARTBEAT_SECONDS * 1000)
		)
		renew.unref()
		try {
			if (job.operation === 'provision') {
				if (!this.config.PROVISIONER_DATABASE_URL)
					throw new Error('PROVISIONER_DATABASE_URL is not configured.')
				await provisionEnvironmentDatabase({
					provisionerUrl: this.config.PROVISIONER_DATABASE_URL,
					databaseName: job.database_name,
					ownerRole: job.owner_role,
					artifactStore:
						this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL &&
						this.config.ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN &&
						this.config.ARTIFACT_STORE_RUNTIME_ROLE &&
						this.config.ARTIFACT_STORE_RUNTIME_PASSWORD
							? {
									provisionerBaseUrl: this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL,
									bearerToken: this.config.ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN,
									runtimeRole: this.config.ARTIFACT_STORE_RUNTIME_ROLE,
									runtimePassword: this.config.ARTIFACT_STORE_RUNTIME_PASSWORD,
									scopeId: job.artifact_scope_id
								}
							: undefined,
					log: { info: (message) => this.addLog(job.id, 'info', message) }
				})
			} else {
				if (!this.config.PROVISIONER_DATABASE_URL)
					throw new Error('PROVISIONER_DATABASE_URL is not configured.')
				await suspendEnvironmentDatabase({
					provisionerUrl: this.config.PROVISIONER_DATABASE_URL,
					databaseName: job.database_name,
					runtimeRole: this.config.ARTIFACT_STORE_RUNTIME_ROLE,
					log: { info: (message) => this.addLog(job.id, 'info', message) }
				})
			}
			await this.complete(job)
		} catch (error) {
			await this.addLog(job.id, 'error', sanitizeError(error)).catch(() => {})
			await this.fail(job, error)
		} finally {
			clearInterval(renew)
		}
	}

	private async complete(job: ClaimedJob): Promise<void> {
		await withTransaction(this.pool, async (client) => {
			const won = await client.query(
				"UPDATE customer_environment_jobs SET status='succeeded',finished_at=now(),lease_owner=NULL,lease_expires_at=NULL,error_code=NULL,error_message=NULL WHERE id=$1 AND status='running' AND lease_owner=$2",
				[job.id, this.instanceId]
			)
			if (won.rowCount !== 1) return
			const status = job.operation === 'suspend' ? 'suspended' : 'ready'
			const timestampColumn = job.operation === 'suspend' ? 'suspended_at' : 'ready_at'
			const artifactStoreStatus =
				job.operation === 'suspend'
					? 'suspended'
					: this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL
						? 'ready'
						: 'pending'
			await client.query(
				`UPDATE customer_environments SET status=$1,artifact_store_status=$3,${timestampColumn}=now(),updated_at=now(),last_error_code=NULL,last_error_message=NULL WHERE id=$2`,
				[status, job.environment_id, artifactStoreStatus]
			)
			await writeAudit(client, {
				eventType: `environment.${status}`,
				metadata: { environmentId: job.environment_id, jobId: job.id }
			})
		})
	}

	private async fail(job: ClaimedJob, error: unknown): Promise<void> {
		const message = sanitizeError(error)
		await withTransaction(this.pool, async (client) => {
			if (job.attempt + 1 < this.config.ENVIRONMENT_MAX_ATTEMPTS) {
				const delay = Math.min(
					this.config.ENVIRONMENT_RETRY_BASE_SECONDS * 2 ** job.attempt,
					this.config.ENVIRONMENT_RETRY_MAX_SECONDS
				)
				const won = await client.query(
					"UPDATE customer_environment_jobs SET status='queued',available_at=$1,lease_owner=NULL,lease_expires_at=NULL,error_code='ENVIRONMENT_OPERATION_FAILED',error_message=$2 WHERE id=$3 AND status='running' AND lease_owner=$4",
					[new Date(Date.now() + delay * 1_000), message, job.id, this.instanceId]
				)
				if (won.rowCount !== 1) return
				await client.query(
					"UPDATE customer_environments SET status='queued',queued_at=now(),updated_at=now(),last_error_code='ENVIRONMENT_OPERATION_FAILED',last_error_message=$1 WHERE id=$2",
					[message, job.environment_id]
				)
				await writeAudit(client, {
					eventType: 'environment.retry_scheduled',
					metadata: { environmentId: job.environment_id, jobId: job.id, delaySeconds: delay }
				})
				return
			}
			const won = await client.query(
				"UPDATE customer_environment_jobs SET status='failed',finished_at=now(),lease_owner=NULL,lease_expires_at=NULL,error_code='ENVIRONMENT_OPERATION_FAILED',error_message=$1 WHERE id=$2 AND status='running' AND lease_owner=$3",
				[message, job.id, this.instanceId]
			)
			if (won.rowCount !== 1) return
			await client.query(
				"UPDATE customer_environments SET status='failed',failed_at=now(),updated_at=now(),last_error_code='ENVIRONMENT_OPERATION_FAILED',last_error_message=$1 WHERE id=$2",
				[message, job.environment_id]
			)
			await writeAudit(client, {
				eventType: 'environment.failed',
				metadata: {
					environmentId: job.environment_id,
					jobId: job.id,
					errorCode: 'ENVIRONMENT_OPERATION_FAILED'
				}
			})
		})
	}
}
