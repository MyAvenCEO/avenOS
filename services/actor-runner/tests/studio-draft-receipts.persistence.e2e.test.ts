import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { newStudioSkillV2 } from '@avenos/actors'
import { databaseNameForEnvironment, type WorkGrantClaims } from '@avenos/aven-customer-contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { readDraftReceipt, type StudioDraftOperation } from '../src/studio-draft-receipts.js'
import { StudioV2Drafts } from '../src/studio-v2-drafts.js'

// Structural transaction/fencing checks, not model-behavior proof. The separate
// dispatched-chat journey loses an actual Qwen edit reply and resumes the model.
const url = process.env.TEST_TASK_DATABASE_URL
const environmentId = randomUUID(),
	subject = randomUUID()
const databaseName = databaseNameForEnvironment(environmentId)
let admin: pg.Pool,
	pool: pg.Pool,
	created = false

describe.skipIf(!url)('atomic Studio draft recovery in PostgreSQL', () => {
	beforeAll(async () => {
		admin = new pg.Pool({ connectionString: url, max: 1 })
		await admin.query(`CREATE DATABASE "${databaseName}"`)
		created = true
		const destination = new URL(url!)
		destination.pathname = '/' + databaseName
		pool = new pg.Pool({
			connectionString: destination.toString(),
			max: 4,
			options: '-c search_path=aven_actor_runs,pg_catalog'
		})
		await pool.query(`CREATE SCHEMA aven_actor_runs; CREATE SCHEMA aven_platform;
      CREATE TABLE aven_platform.environment_identity(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
        environment_id uuid NOT NULL,routing_generation bigint NOT NULL,execution_enabled boolean NOT NULL DEFAULT true)`)
		await pool.query(
			'INSERT INTO aven_platform.environment_identity(environment_id,routing_generation) VALUES($1,1)',
			[environmentId]
		)
		for (const migration of [
			'0001_actor_runs',
			'0002_studio',
			'0003_studio_origin',
			'0004_execution_journal',
			'0005_studio_draft_receipts'
		])
			await pool.query(
				await readFile(
					new URL(
						`../../platform-provisioner/components/actor-runs/${migration}.sql`,
						import.meta.url
					),
					'utf8'
				)
			)
	})
	afterAll(async () => {
		await pool?.end()
		if (created) await admin.query(`DROP DATABASE "${databaseName}"`)
		await admin?.end()
	})

	async function pending(): Promise<StudioDraftOperation> {
		const runId = randomUUID(),
			turnId = randomUUID(),
			leaseOwnerId = randomUUID(),
			invocationId = randomUUID()
		const now = Math.floor(Date.now() / 1000)
		const work: WorkGrantClaims = {
			iss: 'https://synthetic.example.test',
			aud: 'os.aven:executor:actor-runner@1',
			jti: randomUUID(),
			sub: subject,
			sid: randomUUID(),
			role: 'user',
			membershipRole: 'owner',
			environmentId,
			databaseName,
			routingGeneration: 1,
			kind: 'chat-turn',
			inputId: randomUUID(),
			inputRevision: 1,
			materialDigest: 'a'.repeat(64),
			permissions: [
				{ componentRef: 'os.aven:component:actors:run-repository@1', actions: ['actor-runs:write'] }
			],
			iat: now,
			exp: now + 600
		}
		await pool.query(
			`INSERT INTO runs(id,subject_id,idempotency_key,material_hash,state,revision,record)
      VALUES($1::uuid,$2,$1::text,'synthetic','running',1,$3)`,
			[
				runId,
				subject,
				{
					parameters: {
						turnId,
						inputId: work.inputId,
						inputRevision: 1,
						materialDigest: work.materialDigest
					},
					lease: { ownerId: leaseOwnerId, expiresAt: new Date(Date.now() + 600_000).toISOString() }
				}
			]
		)
		await pool.query(
			`INSERT INTO run_steps(run_id,ordinal,invocation_id,kind,material_digest) VALUES($1,0,$2,'tool',$3)`,
			[runId, invocationId, 'b'.repeat(64)]
		)
		return { work, execution: { workId: work.jti, runId, turnId, leaseOwnerId }, invocationId }
	}

	test('retains the exact saved revision despite later edits and rejects redispatch', async () => {
		const operation = await pending(),
			id = randomUUID()
		const drafts = new StudioV2Drafts(pool, operation)
		const original = await drafts.save(
			{ id, revision: 0, definition: newStudioSkillV2('Ceramics class checklist') },
			subject
		)
		await new StudioV2Drafts(pool).save(
			{ id, revision: 1, definition: newStudioSkillV2('Later lesson checklist') },
			subject
		)
		expect(await readDraftReceipt(pool, operation)).toEqual(original)
		await expect(
			drafts.save({ id, revision: 2, definition: newStudioSkillV2('Accidental replay') }, subject)
		).rejects.toThrow('ALREADY_SAVED')
		expect((await drafts.get(id, subject)).revision).toBe(2)
		expect(
			await readDraftReceipt(pool, { ...operation, work: { ...operation.work, sub: randomUUID() } })
		).toBeNull()
		expect(
			await readDraftReceipt(pool, {
				...operation,
				execution: { ...operation.execution, runId: randomUUID() }
			})
		).toBeNull()
	})

	test('a receipt failure rolls back the draft, not just the acknowledgement', async () => {
		const operation = await pending(),
			id = randomUUID()
		await pool.query(`CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$;
      CREATE TRIGGER fail_receipt BEFORE INSERT ON studio_draft_receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt()`)
		try {
			await expect(
				new StudioV2Drafts(pool, operation).save(
					{ id, revision: 0, definition: newStudioSkillV2('Failed save') },
					subject
				)
			).rejects.toThrow('synthetic receipt failure')
			expect((await pool.query('SELECT id FROM studio_drafts WHERE id=$1', [id])).rowCount).toBe(0)
			expect(await readDraftReceipt(pool, operation)).toBeNull()
		} finally {
			await pool.query(
				'DROP TRIGGER fail_receipt ON studio_draft_receipts; DROP FUNCTION fail_receipt()'
			)
		}
	})

	test('concurrent delivery saves once', async () => {
		const operation = await pending(),
			id = randomUUID()
		const write = () =>
			new StudioV2Drafts(pool, operation).save(
				{ id, revision: 0, definition: newStudioSkillV2('Kayak club briefing') },
				subject
			)
		const outcomes = await Promise.allSettled([write(), write()])
		expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		expect((await new StudioV2Drafts(pool).get(id, subject)).revision).toBe(1)
		expect((await readDraftReceipt(pool, operation))?.revision).toBe(1)
	})

	test('wrong lease, subject, generation and invocation cannot save', async () => {
		const operation = await pending(),
			id = randomUUID()
		for (const changed of [
			{ ...operation, execution: { ...operation.execution, leaseOwnerId: randomUUID() } },
			{ ...operation, work: { ...operation.work, sub: randomUUID() } },
			{ ...operation, work: { ...operation.work, routingGeneration: 2 } },
			{ ...operation, invocationId: randomUUID() }
		])
			await expect(
				new StudioV2Drafts(pool, changed).save(
					{ id, revision: 0, definition: newStudioSkillV2('Denied save') },
					subject
				)
			).rejects.toThrow()
		expect((await pool.query('SELECT id FROM studio_drafts WHERE id=$1', [id])).rowCount).toBe(0)
		expect(await readDraftReceipt(pool, operation)).toBeNull()
		await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			await expect(
				new StudioV2Drafts(pool, operation).save(
					{ id, revision: 0, definition: newStudioSkillV2('Paused save') },
					subject
				)
			).rejects.toThrow()
		} finally {
			await pool.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
	})

	test('expired leases and completed invocations cannot change a draft', async () => {
		for (const ended of ['lease', 'invocation']) {
			const operation = await pending(),
				id = randomUUID()
			if (ended === 'lease')
				await pool.query(
					`UPDATE runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1`,
					[operation.execution.runId]
				)
			else
				await pool.query(
					`UPDATE run_steps SET state='complete',value='{}',completed_at=clock_timestamp() WHERE invocation_id=$1`,
					[operation.invocationId]
				)
			await expect(
				new StudioV2Drafts(pool, operation).save(
					{ id, revision: 0, definition: newStudioSkillV2('Ended edit') },
					subject
				)
			).rejects.toThrow()
			expect((await pool.query('SELECT id FROM studio_drafts WHERE id=$1', [id])).rowCount).toBe(0)
			expect(await readDraftReceipt(pool, operation)).toBeNull()
		}
	})
})
