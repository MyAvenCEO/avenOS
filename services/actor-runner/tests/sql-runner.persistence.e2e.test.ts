import { randomUUID } from 'node:crypto'
import { ACTOR_RUN_PROTOCOL, type PlanRunRecord } from '@avenos/actors'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { SqlPlanRunner } from '../src/sql-runner.js'

const databaseUrl = process.env.TEST_ACTOR_RUNNER_DATABASE_URL
const describeWithPostgres = databaseUrl ? describe : describe.skip
const schema = `actor_runner_e2e_${randomUUID().replaceAll('-', '')}`
let admin: pg.Pool

describeWithPostgres('SQL runner persistence', () => {
	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
		await admin.query(`CREATE SCHEMA ${schema}`)
		await admin.query(`
			CREATE TABLE ${schema}.runs (
				id uuid PRIMARY KEY,
				subject_id uuid NOT NULL,
				idempotency_key text NOT NULL,
				material_hash text NOT NULL,
				state text NOT NULL,
				revision bigint NOT NULL,
				record jsonb NOT NULL,
				created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
				updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
				UNIQUE(subject_id,idempotency_key)
			)
		`)
	})

	afterAll(async () => {
		if (!admin) return
		await admin.query(`DROP SCHEMA ${schema} CASCADE`)
		await admin.end()
	})

	test('a fresh runner reclaims a committed accepted run', async () => {
		const firstProcess = new pg.Pool({
			connectionString: databaseUrl,
			max: 1,
			options: `-c search_path=${schema},pg_catalog`
		})
		const runId = randomUUID()
		const subjectId = randomUUID()
		const now = new Date().toISOString()
		const record: PlanRunRecord = {
			protocol: ACTOR_RUN_PROTOCOL,
			runId,
			revision: 1,
			state: 'accepted',
			executionEnvironment: 'server',
			requestId: randomUUID(),
			idempotencyKey: randomUUID(),
			skillRef: 'ceo.aven:skill:e2e:persistence@1',
			security: {
				principal: {
					subjectId,
					kind: 'user',
					assurance: ['passkey'],
					sessionId: randomUUID()
				},
				access: { tenantId: randomUUID() },
				establishedBy: 'api.aven.ceo/actor-runner-boundary',
				authorizedAt: now
			},
			createdAt: now,
			updatedAt: now,
			ingredients: [{ predicate: 'ceo.aven.e2e.done(persistence)' }],
			goals: ['ceo.aven.e2e.done(persistence)'],
			parameters: {},
			checkpoints: [],
			continuations: []
		}

		await firstProcess.query(
			`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
			 VALUES($1,$2,$3,$4,'accepted',1,$5)`,
			[runId, subjectId, record.idempotencyKey, 'e2e-crash-window', record]
		)
		await firstProcess.end()

		const secondProcess = new pg.Pool({
			connectionString: databaseUrl,
			max: 1,
			options: `-c search_path=${schema},pg_catalog`
		})
		try {
			const runner = new SqlPlanRunner(secondProcess, secondProcess)
			expect((await runner.status(runId))?.state).toBe('accepted')
			expect(await runner.recoverAcceptedRuns()).toBe(1)
			expect(await runner.status(runId)).toMatchObject({
				runId,
				state: 'succeeded',
				revision: 2,
				checkpoints: [
					expect.objectContaining({
						ordinal: 0,
						remainingGoals: []
					})
				]
			})
			expect(await runner.recoverAcceptedRuns()).toBe(0)
		} finally {
			await secondProcess.end()
		}
	})
})
