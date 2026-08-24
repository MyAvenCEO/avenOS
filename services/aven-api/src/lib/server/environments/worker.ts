import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type pino from 'pino'
import { sanitizeError } from '../../validation.js'
import { writeAudit } from '../audit.js'
import type { EnvironmentWorkerConfig } from '../config.js'
import { withTransaction } from '../db.js'
import { environmentNames } from './naming.js'
import {
	CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION,
	CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
	CURRENT_INTENT_SERVICE_SCHEMA_VERSION,
	ensureArtifactRuntimeRole,
	ensureIntentRuntimeRole,
	ensureProcessorRuntimeRole,
	provisionEnvironmentDatabase,
	suspendEnvironmentDatabase
} from './provisioning.js'

interface ClaimedJob {
	id: string
	environment_id: string
	operation: 'provision' | 'suspend'
	attempt: number
	database_name: string
	owner_role: string
	artifact_scope_id: string
}

interface ReconciliationSummary {
	backfilled: number
	queued: number
	rewritten: number
	recoveredLeases: number
	terminalFailures: number
}

export class EnvironmentWorker {
	private timer?: NodeJS.Timeout
	private running = false
	private readonly instanceId = randomUUID()
	private readonly started = new Date()
	private lastReconciledAt?: Date
	private reconciliation?: ReconciliationSummary

	constructor(
		private pool: pg.Pool,
		private config: EnvironmentWorkerConfig,
		private logger: pino.Logger
	) {}

	async start(): Promise<void> {
		await this.initialize()
	}

	private async initialize(): Promise<void> {
		if (
			this.config.ARTIFACT_STORE_RUNTIME_ROLE &&
			this.config.ARTIFACT_STORE_RUNTIME_PASSWORD &&
			this.config.PROVISIONER_DATABASE_URL
		) {
			await ensureArtifactRuntimeRole({
				provisionerUrl: this.config.PROVISIONER_DATABASE_URL,
				runtimeRole: this.config.ARTIFACT_STORE_RUNTIME_ROLE,
				runtimePassword: this.config.ARTIFACT_STORE_RUNTIME_PASSWORD,
				log: { info: (message) => this.logger.info(message) }
			})
		}
		if (
			this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE &&
			this.config.ARTIFACT_PROCESSOR_RUNTIME_PASSWORD &&
			this.config.PROVISIONER_DATABASE_URL
		) {
			await ensureProcessorRuntimeRole({
				provisionerUrl: this.config.PROVISIONER_DATABASE_URL,
				runtimeRole: this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE,
				runtimePassword: this.config.ARTIFACT_PROCESSOR_RUNTIME_PASSWORD,
				log: { info: (message) => this.logger.info(message) }
			})
		}
		if (
			this.config.INTENT_SERVICE_RUNTIME_ROLE &&
			this.config.INTENT_SERVICE_RUNTIME_PASSWORD &&
			this.config.PROVISIONER_DATABASE_URL
		) {
			await ensureIntentRuntimeRole({
				provisionerUrl: this.config.PROVISIONER_DATABASE_URL,
				runtimeRole: this.config.INTENT_SERVICE_RUNTIME_ROLE,
				runtimePassword: this.config.INTENT_SERVICE_RUNTIME_PASSWORD,
				log: { info: (message) => this.logger.info(message) }
			})
		}
		await this.reconcileDesiredState()
		this.timer = setInterval(() => {
			void this.tick()
		}, this.config.ENVIRONMENT_WORKER_POLL_INTERVAL_MS)
		this.timer.unref()
		await this.tick()
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer)
	}

	async recoverExpired(): Promise<number> {
		const result = await this.pool.query(
			"UPDATE customer_environment_jobs SET status='queued',lease_owner=NULL,lease_expires_at=NULL,available_at=now() WHERE status='running' AND lease_expires_at < now()"
		)
		return result.rowCount ?? 0
	}

	async enqueueArtifactStoreUpgrades(): Promise<number> {
		return (await this.reconcileDesiredState()).queued
	}

	async reconcileDesiredState(): Promise<ReconciliationSummary> {
		const summary: ReconciliationSummary = {
			backfilled: 0,
			queued: 0,
			rewritten: 0,
			recoveredLeases: await this.recoverExpired(),
			terminalFailures: 0
		}
		summary.backfilled = await this.backfillOwnedNames()
		const environmentIds = (
			await this.pool.query('SELECT id,name FROM customer_environments ORDER BY id')
		).rows as Array<{ id: string; name: string }>
		for (const [index, environment] of environmentIds.entries()) {
			await withTransaction(this.pool, async (client) => {
				await client.query("SELECT pg_advisory_xact_lock(hashtext('name:' || $1))", [
					environment.name
				])
				const state = (
					await client.query(
						`SELECT environment.id,environment.status,environment.artifact_store_status,environment.artifact_store_schema_version,
						        environment.artifact_processor_status,environment.artifact_processor_schema_version,
						        environment.intent_service_status,environment.intent_service_schema_version,
						        environment.last_operation,name_record.status AS name_status
						 FROM customer_environments environment
						 JOIN names name_record ON name_record.name=environment.name
						 WHERE environment.id=$1 FOR UPDATE OF environment`,
						[environment.id]
					)
				).rows[0] as
					| {
							id: string
							status: string
							artifact_store_status: string
							artifact_store_schema_version: number
							artifact_processor_status: string
							artifact_processor_schema_version: number
							intent_service_status: string
							intent_service_schema_version: number
							last_operation: 'provision' | 'suspend' | null
							name_status: string
					  }
					| undefined
				if (!state) return
				const desired: 'provision' | 'suspend' =
					state.name_status === 'owned' ? 'provision' : 'suspend'
				const unfinished = (
					await client.query(
						`SELECT id,operation,status FROM customer_environment_jobs
						 WHERE environment_id=$1 AND status IN ('queued','running')
						 FOR UPDATE`,
						[state.id]
					)
				).rows[0] as
					| { id: string; operation: 'provision' | 'suspend'; status: 'queued' | 'running' }
					| undefined
				if (unfinished) {
					if (unfinished.status === 'queued' && unfinished.operation !== desired) {
						await client.query(
							`UPDATE customer_environment_jobs
							 SET operation=$1,attempt=0,available_at=now(),error_code=NULL,error_message=NULL
							 WHERE id=$2`,
							[desired, unfinished.id]
						)
						await client.query(
							"UPDATE customer_environments SET status='queued',last_operation=$1,queued_at=now(),updated_at=now() WHERE id=$2",
							[desired, state.id]
						)
						summary.rewritten += 1
					}
					return
				}

				const artifactConfigured = Boolean(
					this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL &&
						this.config.ARTIFACT_STORE_PROVISIONER_BEARER_TOKEN &&
						this.config.ARTIFACT_STORE_RUNTIME_ROLE &&
						this.config.ARTIFACT_STORE_RUNTIME_PASSWORD
				)
				const processorConfigured = Boolean(
					this.config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL &&
						this.config.ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN &&
						this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE &&
						this.config.ARTIFACT_PROCESSOR_RUNTIME_PASSWORD
				)
				const intentConfigured = Boolean(
					this.config.INTENT_SERVICE_PROVISIONER_BASE_URL &&
						this.config.INTENT_SERVICE_PROVISIONER_BEARER_TOKEN &&
						this.config.INTENT_SERVICE_RUNTIME_ROLE &&
						this.config.INTENT_SERVICE_RUNTIME_PASSWORD
				)
				const needsOperation =
					desired === 'suspend'
						? state.status !== 'suspended' ||
							state.artifact_store_status !== 'suspended' ||
							state.artifact_processor_status !== 'suspended' ||
							state.intent_service_status !== 'suspended'
						: state.status !== 'ready' ||
							(artifactConfigured &&
								(state.artifact_store_status !== 'ready' ||
									state.artifact_store_schema_version < CURRENT_ARTIFACT_STORE_SCHEMA_VERSION)) ||
							(processorConfigured &&
								(state.artifact_processor_status !== 'ready' ||
									state.artifact_processor_schema_version <
										CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION)) ||
							(intentConfigured &&
								(state.intent_service_status !== 'ready' ||
									state.intent_service_schema_version < CURRENT_INTENT_SERVICE_SCHEMA_VERSION))
				if (!needsOperation) return
				if (state.status === 'failed' && state.last_operation === desired) {
					summary.terminalFailures += 1
					return
				}
				const inserted = await client.query(
					`INSERT INTO customer_environment_jobs
					   (id,environment_id,operation,status,attempt,available_at,created_at)
					 VALUES ($1,$2,$3,'queued',0,now(),now()) ON CONFLICT DO NOTHING`,
					[randomUUID(), state.id, desired]
				)
				if (inserted.rowCount !== 1) return
				await client.query(
					`UPDATE customer_environments
					 SET status='queued',last_operation=$1,
					     artifact_store_status=CASE WHEN $1='provision' THEN 'pending' ELSE artifact_store_status END,
					     artifact_processor_status=CASE WHEN $1='provision' THEN 'pending' ELSE artifact_processor_status END,
					     intent_service_status=CASE WHEN $1='provision' THEN 'pending' ELSE intent_service_status END,
					     queued_at=now(),updated_at=now(),last_error_code=NULL,last_error_message=NULL
					 WHERE id=$2`,
					[desired, state.id]
				)
				await writeAudit(client, {
					eventType: 'environment.reconciled_operation_queued',
					metadata: { environmentId: state.id, operation: desired }
				})
				summary.queued += 1
			})
			if ((index + 1) % 25 === 0) await this.heartbeat()
		}
		this.lastReconciledAt = new Date()
		this.reconciliation = summary
		return summary
	}

	private async backfillOwnedNames(): Promise<number> {
		const missing = (
			await this.pool.query(
				`SELECT name_record.name
				 FROM names name_record
				 LEFT JOIN customer_environments environment ON environment.name=name_record.name
				 WHERE name_record.status='owned' AND environment.id IS NULL
				 ORDER BY name_record.name LIMIT 100`
			)
		).rows as Array<{ name: string }>
		let backfilled = 0
		for (const candidate of missing) {
			await withTransaction(this.pool, async (client) => {
				await client.query("SELECT pg_advisory_xact_lock(hashtext('name:' || $1))", [
					candidate.name
				])
				const name = (
					await client.query('SELECT name,owner_user_id,status FROM names WHERE name=$1', [
						candidate.name
					])
				).rows[0] as { name: string; owner_user_id: string; status: string } | undefined
				if (name?.status !== 'owned') return
				const exists = await client.query('SELECT 1 FROM customer_environments WHERE name=$1', [
					name.name
				])
				if (exists.rowCount) return
				const names = environmentNames(name.name)
				const environmentId = randomUUID()
				const effectiveConfig = {
					contractVersion: 2,
					name: names.name,
					databaseName: names.databaseName,
					stackName: names.stackName,
					artifactStore: {
						schemaVersion: CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
						scopeId: environmentId
					},
					artifactProcessor: {
						schemaVersion: CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION,
						scopeId: environmentId
					},
					intentService: {
						schemaVersion: CURRENT_INTENT_SERVICE_SCHEMA_VERSION,
						scopeId: environmentId
					},
					applications: []
				}
				await client.query(
					`INSERT INTO customer_environments
					  (id,owner_user_id,name,database_name,artifact_scope_id,artifact_store_status,owner_role,stack_name,contract_version,effective_config,status,last_operation,queued_at,updated_at)
					 VALUES ($1,$2,$3,$4,$1,'pending',$5,$6,2,$7,'queued','provision',now(),now())`,
					[
						environmentId,
						name.owner_user_id,
						names.name,
						names.databaseName,
						names.ownerRole,
						names.stackName,
						JSON.stringify(effectiveConfig)
					]
				)
				await client.query(
					`INSERT INTO customer_environment_jobs
					  (id,environment_id,operation,status,attempt,available_at,created_at)
					 VALUES ($1,$2,'provision','queued',0,now(),now())`,
					[randomUUID(), environmentId]
				)
				await writeAudit(client, {
					eventType: 'environment.legacy_name_reconciled',
					targetUserId: name.owner_user_id,
					metadata: { environmentId, name: name.name }
				})
				backfilled += 1
			})
		}
		return backfilled
	}

	private async heartbeat(): Promise<void> {
		const metadata = JSON.stringify({
			concurrency: 1,
			lastReconciledAt: this.lastReconciledAt?.toISOString() ?? null,
			reconciliation: this.reconciliation ?? null
		})
		await this.pool.query(
			`INSERT INTO worker_heartbeats(worker_name,instance_id,version,started_at,last_heartbeat_at,metadata)
       VALUES('environment-worker',$1,$2,$3,now(),$4::jsonb)
       ON CONFLICT(worker_name) DO UPDATE SET instance_id=EXCLUDED.instance_id,version=EXCLUDED.version,last_heartbeat_at=EXCLUDED.last_heartbeat_at,metadata=EXCLUDED.metadata`,
			[this.instanceId, this.config.APPLICATION_VERSION, this.started, metadata]
		)
	}

	async tick(): Promise<void> {
		if (this.running) return
		this.running = true
		try {
			await this.heartbeat()
			if (
				!this.lastReconciledAt ||
				Date.now() - this.lastReconciledAt.getTime() >=
					this.config.ENVIRONMENT_RECONCILE_INTERVAL_SECONDS * 1_000
			) {
				await this.reconcileDesiredState()
				await this.heartbeat()
			}
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
				void this.renewLease(job).catch((error) => {
					this.logger.error(
						{ err: sanitizeError(error), jobId: job.id },
						'environment job lease renewal failed'
					)
				})
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
									scopeId: job.artifact_scope_id
								}
							: undefined,
					artifactProcessor:
						this.config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL &&
						this.config.ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN &&
						this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE &&
						this.config.ARTIFACT_PROCESSOR_RUNTIME_PASSWORD
							? {
									provisionerBaseUrl: this.config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL,
									bearerToken: this.config.ARTIFACT_PROCESSOR_PROVISIONER_BEARER_TOKEN,
									runtimeRole: this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE,
									scopeId: job.artifact_scope_id
								}
							: undefined,
					intentService:
						this.config.INTENT_SERVICE_PROVISIONER_BASE_URL &&
						this.config.INTENT_SERVICE_PROVISIONER_BEARER_TOKEN &&
						this.config.INTENT_SERVICE_RUNTIME_ROLE &&
						this.config.INTENT_SERVICE_RUNTIME_PASSWORD
							? {
									provisionerBaseUrl: this.config.INTENT_SERVICE_PROVISIONER_BASE_URL,
									bearerToken: this.config.INTENT_SERVICE_PROVISIONER_BEARER_TOKEN,
									runtimeRole: this.config.INTENT_SERVICE_RUNTIME_ROLE,
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
					runtimeRoles: [
						this.config.ARTIFACT_STORE_RUNTIME_ROLE,
						this.config.ARTIFACT_PROCESSOR_RUNTIME_ROLE,
						this.config.INTENT_SERVICE_RUNTIME_ROLE
					].filter((role): role is string => Boolean(role)),
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

	private async renewLease(job: ClaimedJob): Promise<void> {
		const renewed = await this.pool.query(
			"UPDATE customer_environment_jobs SET lease_expires_at=$1 WHERE id=$2 AND status='running' AND lease_owner=$3",
			[
				new Date(Date.now() + this.config.ENVIRONMENT_WORKER_LEASE_SECONDS * 1_000),
				job.id,
				this.instanceId
			]
		)
		if (renewed.rowCount !== 1) {
			await this.addLog(job.id, 'error', 'Worker lost the environment job lease.').catch(() => {})
			throw new Error('Worker lost the environment job lease.')
		}
		await this.heartbeat()
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
			const artifactStoreProvisioned =
				job.operation === 'provision' && Boolean(this.config.ARTIFACT_STORE_PROVISIONER_BASE_URL)
			const artifactProcessorStatus =
				job.operation === 'suspend'
					? 'suspended'
					: this.config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL
						? 'ready'
						: 'pending'
			const artifactProcessorProvisioned =
				job.operation === 'provision' &&
				Boolean(this.config.ARTIFACT_PROCESSOR_PROVISIONER_BASE_URL)
			const intentServiceStatus =
				job.operation === 'suspend'
					? 'suspended'
					: this.config.INTENT_SERVICE_PROVISIONER_BASE_URL
						? 'ready'
						: 'pending'
			const intentServiceProvisioned =
				job.operation === 'provision' && Boolean(this.config.INTENT_SERVICE_PROVISIONER_BASE_URL)
			await client.query(
				`UPDATE customer_environments
				 SET status=$1,artifact_store_status=$3,
				     artifact_store_schema_version=CASE WHEN $4 THEN $5 ELSE artifact_store_schema_version END,
				     artifact_processor_status=$6,
				     artifact_processor_schema_version=CASE WHEN $7 THEN $8 ELSE artifact_processor_schema_version END,
				     intent_service_status=$9,
				     intent_service_schema_version=CASE WHEN $10 THEN $11 ELSE intent_service_schema_version END,
				     ${timestampColumn}=now(),updated_at=now(),last_error_code=NULL,last_error_message=NULL
				 WHERE id=$2`,
				[
					status,
					job.environment_id,
					artifactStoreStatus,
					artifactStoreProvisioned,
					CURRENT_ARTIFACT_STORE_SCHEMA_VERSION,
					artifactProcessorStatus,
					artifactProcessorProvisioned,
					CURRENT_ARTIFACT_PROCESSOR_SCHEMA_VERSION,
					intentServiceStatus,
					intentServiceProvisioned,
					CURRENT_INTENT_SERVICE_SCHEMA_VERSION
				]
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
