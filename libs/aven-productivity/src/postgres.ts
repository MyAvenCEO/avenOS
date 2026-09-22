import { createHash } from 'node:crypto'
import type pg from 'pg'
import { z } from 'zod'
import {
	changedTasks,
	type Task,
	type TaskCause,
	type TaskCommand,
	TaskConflict,
	type TaskPage,
	type TaskQuery,
	type TaskReceipt,
	type TaskRepository,
	taskCauseSchema,
	taskCommandSchema,
	taskListSchema,
	taskMaterial,
	taskSchema
} from './tasks'

/** Uses only a productivity function role and schema; never reads another component. */
export class SqlTaskRepository implements TaskRepository {
	readonly mode = 'production' as const
	constructor(
		private readonly pool: pg.Pool,
		private readonly environment: { environmentId: string; routingGeneration: number }
	) {}
	private async checkEnvironment(client: Pick<pg.Pool, 'query'> | pg.PoolClient, write = false) {
		const result = await client.query(
			`SELECT 1 FROM aven_platform.environment_identity
      WHERE singleton AND environment_id=$1 AND routing_generation=$2 AND (NOT $3 OR execution_enabled)`,
			[this.environment.environmentId, this.environment.routingGeneration, write]
		)
		if (result.rowCount !== 1)
			throw new TaskConflict(
				'This workspace changed or its work is paused. Reconnect before continuing.'
			)
	}
	async list(owner: string, raw: TaskQuery): Promise<TaskPage> {
		z.uuid().parse(owner)
		await this.checkEnvironment(this.pool)
		const query = taskListSchema.parse(raw)
		const rows = await this.pool.query<{ record: Task }>(
			`SELECT record FROM aven_productivity.tasks WHERE owner_subject_id=$1 AND archived=$2
       AND ($3::uuid IS NULL OR id > $3) AND ($4::text IS NULL OR record->>'group'=$4)
       AND ($5::uuid IS NULL OR intent_id=$5) AND ($6::text IS NULL OR record->>'status'=$6)
       ORDER BY id LIMIT $7`,
			[
				owner,
				query.archived,
				query.after ?? null,
				query.group ?? null,
				query.intentId ?? null,
				query.status ?? null,
				query.limit + 1
			]
		)
		const tasks = rows.rows.slice(0, query.limit).map((row) => taskSchema.parse(row.record))
		const complete = rows.rows.length <= query.limit
		return { tasks, complete, next: complete ? null : tasks.at(-1)!.id, selection: query }
	}
	async receipt(owner: string, operationId: string): Promise<TaskReceipt | null> {
		z.uuid().parse(owner)
		z.uuid().parse(operationId)
		await this.checkEnvironment(this.pool)
		return (
			(
				await this.pool.query<{ receipt: TaskReceipt }>(
					'SELECT receipt FROM aven_productivity.task_commands WHERE owner_subject_id=$1 AND operation_id=$2',
					[owner, operationId]
				)
			).rows[0]?.receipt ?? null
		)
	}
	async execute(owner: string, raw: TaskCommand, rawCause: TaskCause): Promise<TaskReceipt> {
		z.uuid().parse(owner)
		const command = taskCommandSchema.parse(raw),
			cause = taskCauseSchema.parse(rawCause)
		const digest = createHash('sha256').update(taskMaterial(command, cause)).digest('hex')
		const client = await this.pool.connect()
		try {
			await client.query('BEGIN')
			await this.checkEnvironment(client, true)
			// Lock per owner, not the workspace. Commands have bounded batches and contain no model/network calls.
			await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`tasks:${owner}`])
			const prior = (
				await client.query<{ material_digest: string; receipt: TaskReceipt }>(
					'SELECT material_digest,receipt FROM aven_productivity.task_commands WHERE owner_subject_id=$1 AND operation_id=$2',
					[owner, cause.operationId]
				)
			).rows[0]
			if (prior) {
				if (prior.material_digest !== digest)
					throw new TaskConflict('This operation was already used for a different change.')
				await client.query('COMMIT')
				return prior.receipt
			}
			const now = (
				await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')
			).rows[0]!.now.toISOString()
			const previous =
				command.operation === 'create'
					? []
					: (
							await client.query<{ record: Task }>(
								'SELECT record FROM aven_productivity.tasks WHERE owner_subject_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',
								[owner, command.tasks.map((task) => task.id)]
							)
						).rows.map((row) => taskSchema.parse(row.record))
			// Validate the complete batch before changing any record.
			const tasks = changedTasks(owner, command, cause, previous, now)
			if (command.operation === 'create') {
				for (const task of tasks) {
					await client.query(
						`INSERT INTO aven_productivity.tasks(id,owner_subject_id,intent_id,revision,archived,record)
            VALUES($1,$2,$3,1,false,$4)`,
						[task.id, owner, cause.intentId, task]
					)
				}
			} else {
				for (const task of tasks) {
					await client.query(
						'UPDATE aven_productivity.tasks SET revision=$3,archived=$4,record=$5,intent_id=$6 WHERE id=$1 AND owner_subject_id=$2',
						[task.id, owner, task.revision, task.archived, task, task.intentId]
					)
				}
			}
			const receipt: TaskReceipt = {
				operationId: cause.operationId,
				operation: command.operation,
				completedAt: now,
				tasks
			}
			await client.query(
				`INSERT INTO aven_productivity.task_commands(owner_subject_id,operation_id,material_digest,cause,receipt)
        VALUES($1,$2,$3,$4,$5)`,
				[owner, cause.operationId, digest, cause, receipt]
			)
			for (const task of tasks)
				await client.query(
					`INSERT INTO aven_productivity.task_revisions(task_id,revision,owner_subject_id,operation_id,record)
        VALUES($1,$2,$3,$4,$5)`,
					[task.id, task.revision, owner, cause.operationId, task]
				)
			await client.query('COMMIT')
			return receipt
		} catch (error) {
			await client.query('ROLLBACK').catch(() => {})
			throw error
		} finally {
			client.release()
		}
	}
}
