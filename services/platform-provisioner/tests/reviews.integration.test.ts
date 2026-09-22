import { randomUUID } from 'node:crypto'
import {
	databaseNameForEnvironment,
	databaseRoleName,
	deriveDatabasePassword,
	quoteIdentifier
} from '@avenos/aven-customer-contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { proveReviewSession } from '../../../deploy/e2e/live-review-session'
import {
	type ReviewRecord,
	ReviewStore,
	requireApprovedReview,
	reviewContinuation,
	reviewSubjectDigest
} from '../../actor-runner/src/reviews'
import { type ComponentCatalogEntry, loadCatalog } from '../src/catalog'
import { provisionerConfigSchema } from '../src/config'
import { CustomerDatabaseProvisioner } from '../src/postgres'

const url = process.env.PROVISIONER_TEST_DATABASE_URL
const environmentId = randomUUID(),
	subjectId = randomUUID(),
	databaseName = databaseNameForEnvironment(environmentId)
const root = Buffer.alloc(32, 43).toString('base64url')
let admin: pg.Pool, database: pg.Pool, api: pg.Pool, worker: pg.Pool, entry: ComponentCatalogEntry
let reviews: ReviewStore, decisions: ReviewStore
const scope = { environmentId, subjectId, generation: 1 }

async function proposal() {
	const runId = randomUUID(),
		ownerId = randomUUID(),
		reviewId = randomUUID()
	const subject = {
		operation: 'Read greenhouse inventory',
		target: 'https://seed.example.test/reports',
		limit: 4096
	}
	const request = {
		id: reviewId,
		revision: 1,
		invocationId: 'root.inventory',
		subjectSchema: 'example:schema:greenhouse:read-review@1',
		subject,
		subjectDigest: reviewSubjectDigest(subject),
		title: 'Read seed inventory?',
		expiresAt: new Date(Date.now() + 60000).toISOString()
	}
	await api.query(
		`INSERT INTO aven_actor_runs.runs(id,subject_id,idempotency_key,material_hash,state,revision,record,execution_owner)
    VALUES($1::uuid,$2,$1::text,'synthetic','running',1,$3,$4)`,
		[
			runId,
			subjectId,
			{
				lease: { ownerId, expiresAt: new Date(Date.now() + 60000).toISOString() },
				continuations: []
			},
			ownerId
		]
	)
	const record = await reviews.open(runId, ownerId, request)
	const wait = async (value = record) =>
		api.query(
			`UPDATE aven_actor_runs.runs SET state='waiting_for_input',
    record=jsonb_set(record,'{continuations}',$2::jsonb) WHERE id=$1`,
			[runId, JSON.stringify([reviewContinuation(value)])]
		)
	return { runId, ownerId, request, record, wait }
}
const command = (record: ReviewRecord, outcome: 'approve' | 'deny' | 'postpone' = 'approve') => ({
	id: randomUUID(),
	revision: record.revision,
	subjectDigest: record.subjectDigest,
	expectedEventVersion: record.eventVersion,
	outcome
})
describe.skipIf(!url)('provisioned shared human review boundary', () => {
	beforeAll(async () => {
		if (
			!url ||
			!['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ||
			new URL(url).pathname !== '/postgres'
		)
			throw Error('Isolated local PostgreSQL required')
		entry = (await loadCatalog()).get('os.aven:component:actors:run-repository@1')!
		admin = new pg.Pool({ connectionString: url })
		const config = provisionerConfigSchema.parse({
			CLUSTER_DATABASE_URL: url,
			CONTROL_DATABASE_URL: url,
			INTENTS_API_DB_CREDENTIAL_ROOT: root,
			PRODUCTIVITY_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_API_DB_CREDENTIAL_ROOT: root,
			ACTOR_WORKER_DB_CREDENTIAL_ROOT: root,
			ARTIFACT_API_DB_CREDENTIAL_ROOT: root,
			BACKUP_DATABASE_ROLE: new URL(url).username,
			ARTIFACT_STORE_PROVISIONER_URL: 'http://127.0.0.1:1',
			ARTIFACT_STORE_PROVISIONER_TOKEN: 'x'.repeat(32)
		})
		const provisioner = new CustomerDatabaseProvisioner(url, config)
		const operation = {
			id: randomUUID(),
			environmentId,
			databaseName,
			componentRef: entry.manifest.componentRef,
			action: 'reconcile' as const,
			targetSchemaVersion: 7,
			migrationSetDigest: entry.manifest.migrationSetDigest,
			routingGeneration: 1
		}
		await provisioner.reconcile(operation, entry)
		await provisioner.verify(operation, entry)
		const target = new URL(url)
		target.pathname = '/' + databaseName
		database = new pg.Pool({ connectionString: target.toString() })
		const rolePool = (suffix: string, kind: string) => {
			const login = new URL(target)
			login.username = databaseRoleName(environmentId, suffix)
			login.password = deriveDatabasePassword({
				root,
				environmentId,
				routingGeneration: 1,
				roleKind: kind
			})
			return new pg.Pool({
				connectionString: login.toString(),
				max: 3,
				options: '-c search_path=aven_actor_runs,pg_catalog'
			})
		}
		api = rolePool('act_api', 'os.aven:db-role:actors:api@1')
		worker = rolePool('act_worker', 'os.aven:db-role:actors:worker@1')
		reviews = new ReviewStore(worker, scope)
		decisions = new ReviewStore(api, scope)
	}, 30000)
	afterAll(async () => {
		await Promise.all([api?.end(), worker?.end(), database?.end()])
		if (!admin) return
		try {
			await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH(FORCE)`)
			for (const suffix of ['act_api', 'act_worker', 'act_owner', 'platform_owner', 'db_owner'])
				await admin.query(
					`DROP ROLE IF EXISTS ${quoteIdentifier(databaseRoleName(environmentId, suffix))}`
				)
		} finally {
			await admin.end()
		}
	})
	test('workers can propose but cannot approve; API cannot replace the reviewed subject', async () => {
		const p = await proposal()
		expect(await reviews.open(p.runId, p.ownerId, p.request)).toEqual(p.record)
		await expect(
			reviews.open(p.runId, p.ownerId, { ...p.request, title: 'Changed request' })
		).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
		await expect(decisions.open(p.runId, p.ownerId, p.request)).rejects.toMatchObject({
			code: 'REVIEW_UNAVAILABLE'
		})
		await expect(
			reviews.decide(p.runId, p.record.id, 'session', command(p.record))
		).rejects.toMatchObject({ code: 'REVIEW_UNAVAILABLE' })
		for (const pool of [api, worker]) {
			await expect(
				pool.query('SELECT * FROM aven_actor_runs.review_requests')
			).rejects.toMatchObject({ code: '42501' })
			await expect(
				pool.query("UPDATE aven_actor_runs.review_decisions SET outcome='approve'")
			).rejects.toMatchObject({ code: '42501' })
		}
	})
	test('requires a durable waiting continuation and exact review digest', async () => {
		const p = await proposal()
		await expect(
			decisions.decide(p.runId, p.record.id, 'session', command(p.record))
		).rejects.toMatchObject({ code: 'REVIEW_NOT_OPEN' })
		await p.wait()
		await expect(
			decisions.decide(p.runId, p.record.id, 'session', {
				...command(p.record),
				subjectDigest: 'a'.repeat(64)
			})
		).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
		const foreign = new ReviewStore(api, { ...scope, subjectId: randomUUID() })
		await expect(foreign.read(p.runId, p.record.id)).rejects.toMatchObject({
			code: 'REVIEW_NOT_FOUND'
		})
		const approved = await decisions.decide(p.runId, p.record.id, 'session', command(p.record))
		expect(
			requireApprovedReview(approved, {
				runId: p.runId,
				invocationId: p.request.invocationId,
				subjectDigest: p.request.subjectDigest,
				generation: 1,
				subjectId
			})
		).toBe(approved.decision!.id)
		expect(() =>
			requireApprovedReview(p.record, {
				runId: p.runId,
				invocationId: p.request.invocationId,
				subjectDigest: p.request.subjectDigest,
				generation: 1,
				subjectId
			})
		).toThrow('REVIEW_APPROVAL_REQUIRED')
	})
	test('postpone persists, simultaneous answers serialize and terminal decisions cannot change', async () => {
		const p = await proposal()
		await p.wait()
		const postponed = await decisions.decide(
			p.runId,
			p.record.id,
			'session',
			command(p.record, 'postpone')
		)
		expect((await new ReviewStore(api, scope).read(p.runId, p.record.id)).decision?.outcome).toBe(
			'postpone'
		)
		const accept = command(postponed),
			decline = command(postponed, 'deny')
		const results = await Promise.allSettled([
			decisions.decide(p.runId, p.record.id, 'session', accept),
			decisions.decide(p.runId, p.record.id, 'session', decline)
		])
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
		const retained = await decisions.read(p.runId, p.record.id)
		const winner = retained.decision!.id === accept.id ? accept : decline
		expect(await decisions.decide(p.runId, p.record.id, 'session', winner)).toEqual(retained)
		await expect(
			decisions.decide(p.runId, p.record.id, 'session', command(retained))
		).rejects.toMatchObject({ code: 'REVIEW_CONFLICT' })
	})
	test('a renamed duplicate of a declined operation cannot ask again in the same invocation', async () => {
		const p = await proposal()
		await p.wait()
		await decisions.decide(p.runId, p.record.id, 'session', {
			...command(p.record),
			outcome: 'deny'
		})
		await api.query("UPDATE aven_actor_runs.runs SET state='running' WHERE id=$1", [p.runId])
		await expect(
			reviews.open(p.runId, p.ownerId, {
				...p.request,
				id: randomUUID(),
				revision: 2,
				title: 'Please reconsider'
			})
		).rejects.toMatchObject({ code: 'REVIEW_NOT_OPEN' })
	})
	test('new revisions supersede old approvals and expired or stale-generation requests are denied', async () => {
		const p = await proposal()
		await p.wait()
		await decisions.decide(p.runId, p.record.id, 'session', command(p.record))
		await api.query("UPDATE aven_actor_runs.runs SET state='running' WHERE id=$1", [p.runId])
		const next = await reviews.open(p.runId, p.ownerId, {
			...p.request,
			id: randomUUID(),
			revision: 2,
			title: 'Read the updated inventory?'
		})
		await p.wait(next)
		expect((await decisions.read(p.runId, p.record.id)).superseded).toBe(true)
		await database.query(
			"UPDATE aven_actor_runs.review_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
			[next.id]
		)
		await expect(
			decisions.decide(p.runId, next.id, 'session', command(next))
		).rejects.toMatchObject({ code: 'REVIEW_NOT_OPEN' })
		await expect(
			new ReviewStore(api, { ...scope, generation: 2 }).read(p.runId, next.id)
		).rejects.toMatchObject({ code: 'REVIEW_SCOPE_UNAVAILABLE' })
		await database.query('UPDATE aven_platform.environment_identity SET execution_enabled=false')
		try {
			await expect(decisions.read(p.runId, next.id)).rejects.toMatchObject({
				code: 'REVIEW_SCOPE_UNAVAILABLE'
			})
		} finally {
			await database.query('UPDATE aven_platform.environment_identity SET execution_enabled=true')
		}
	})
	test('expired lease cannot propose work, including replay of an earlier request', async () => {
		const p = await proposal()
		await expect(reviews.open(p.runId, randomUUID(), p.request)).rejects.toMatchObject({
			code: 'REVIEW_EXECUTION_INACTIVE'
		})
		await api.query(
			"UPDATE aven_actor_runs.runs SET record=jsonb_set(record,'{lease,expiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1",
			[p.runId]
		)
		await expect(reviews.open(p.runId, p.ownerId, p.request)).rejects.toMatchObject({
			code: 'REVIEW_EXECUTION_INACTIVE'
		})
	})
	test.skipIf(!process.env.LIVE_LLM_BASE_URL)(
		'real Qwen with durable review, restart, denial and approval through signed ingress',
		async () => {
			await proveReviewSession(api, worker, scope, process.env.LIVE_LLM_BASE_URL!)
		},
		300000
	)
})
