import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { PlanRunSecurityContext } from '@avenos/actors'
import { draftFor, type StudioDefinition } from '@avenos/actors/studio'
import { ArtifactStoreClient } from '@avenos/artifact-store'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { SqlPlanRunner } from '../src/sql-runner'
import { StudioArtifacts, studioObject } from '../src/studio-artifacts'
import { createStudioExecutor } from '../src/studio-executor'
import { StudioService } from '../src/studio-service'

const databaseUrl = process.env.TEST_ACTOR_RUNNER_DATABASE_URL
const baseUrl = process.env.TEST_ARTIFACT_STORE_BASE_URL
const bearerToken = process.env.TEST_ARTIFACT_STORE_BEARER_TOKEN
const scope = process.env.TEST_ARTIFACT_STORE_SCOPE_ID
const enabled = databaseUrl && baseUrl && bearerToken && scope
const schema = 'studio_e2e_' + randomUUID().replaceAll('-', '')
let admin: pg.Pool
let pool: pg.Pool
let runner: SqlPlanRunner
let service: StudioService
let store: StudioArtifacts
const security: PlanRunSecurityContext = {
	principal: { subjectId: randomUUID(), kind: 'user', assurance: ['passkey'] },
	access: { tenantId: scope! },
	establishedBy: 'studio-persistence-test',
	authorizedAt: new Date().toISOString()
}
const file = { key: 'core.file', version: 1 }
const understanding = { key: 'studio.understanding', version: 1 }
const brief = { key: 'studio.brief', version: 1 }
const call = async (
	operation: string,
	data: Record<string, unknown> = {},
	readOnly = false
): Promise<any> => service.call({ operation, data }, security, {}, readOnly)
async function publish(definition: StudioDefinition) {
	const draft = await call('draft', { id: randomUUID(), revision: 0, definition })
	return call('publish', { id: draft.id, revision: draft.revision })
}
async function settle(count: number) {
	const deadline = Date.now() + 45000
	while (Date.now() < deadline) {
		await call('sync')
		const state = await call('state')
		if (state.connections.some((c: any) => c.last_error))
			throw new Error(JSON.stringify(state.connections))
		if (state.deliveries.some((d: any) => d.last_error))
			throw new Error(JSON.stringify(state.deliveries))
		if (state.runs.some((r: any) => r.state === 'failed'))
			throw new Error(JSON.stringify(state.runs))
		if (state.runs.filter((r: any) => r.state === 'succeeded').length >= count) return state
		await new Promise((resolve) => setTimeout(resolve, 80))
	}
	throw new Error('Studio did not finish: ' + JSON.stringify(await call('state')))
}
;(enabled ? describe : describe.skip)(
	'Studio with PostgreSQL and the production Artifact Store',
	() => {
		beforeAll(async () => {
			admin = new pg.Pool({ connectionString: databaseUrl, max: 1 })
			await admin.query('CREATE SCHEMA ' + schema)
			for (const migration of ['0001_actor_runs', '0002_studio']) {
				const sql = await readFile(
					new URL(
						'../../platform-provisioner/components/actor-runs/' + migration + '.sql',
						import.meta.url
					),
					'utf8'
				)
				await admin.query(sql.replaceAll('aven_actor_runs.', schema + '.'))
			}
			pool = new pg.Pool({
				connectionString: databaseUrl,
				max: 8,
				options: '-c search_path=' + schema + ',pg_catalog'
			})
			const client = new ArtifactStoreClient({ baseUrl: baseUrl!, bearerToken: () => bearerToken! })
			store = new StudioArtifacts(client, scope!)
			runner = new SqlPlanRunner(
				pool,
				pool,
				createStudioExecutor(store, {
					artifactsFor: () => ({ client, scopeId: scope!, userId: security.principal.subjectId })
				})
			)
			service = new StudioService(pool, store, runner)
		})
		afterAll(async () => {
			await runner?.close()
			await pool?.end()
			if (admin) {
				await admin.query('DROP SCHEMA ' + schema + ' CASCADE')
				await admin.end()
			}
		})
		test('sample arrival → nested document Skill → real understanding → subscribed brief; restart and replay preserve lineage', async () => {
			const first = await call('sample', {
				requestId: randomUUID(),
				observedAt: new Date().toISOString()
			})
			const child = await publish(draftFor(file, understanding, 'Document child'))
			const parentDefinition = draftFor(file, understanding, 'Mailbox parent')
			parentDefinition.steps = [
				{
					id: 'document',
					kind: 'skill',
					label: 'Document child',
					ref: child.published_artifact_id,
					inputs: { source: { kind: 'input', name: 'source' } },
					parameters: {}
				}
			]
			parentDefinition.output.from.name = 'document'
			const parent = await publish(parentDefinition)
			const follow = await publish(draftFor(understanding, brief, 'Brief follow-on'))
			const sourceConnectionId = randomUUID()
			await call('connect', {
				id: sourceConnectionId,
				name: 'Mailbox to parent',
				skillArtifactId: parent.published_artifact_id,
				sourceArtifactId: first.source.artifactId,
				inputPort: 'source',
				fixedInputs: {},
				enabled: true
			})
			await call('connect', {
				id: randomUUID(),
				name: 'Understanding to brief',
				skillArtifactId: follow.published_artifact_id,
				sourceArtifactId: null,
				inputPort: 'source',
				fixedInputs: {},
				enabled: true
			})
			await call('sync')
			expect((await call('state')).runs).toHaveLength(0) // future arrivals, not the initial sample
			const capture = { requestId: randomUUID(), observedAt: new Date().toISOString() }
			const incoming = await call('sample', capture)
			let state = await settle(2)
			expect(state.runs).toHaveLength(2)
			const output = state.runs
				.flatMap((r: any) => r.checkpoints)
				.map((c: any) => c.output?.artifact)
				.find((a: any) => a?.typeKey === 'studio.brief')
			expect(output).toBeTruthy()
			const briefInputs = studioObject(
				await store.client.producerInputs(scope!, output.artifactId)
			).inputs
			const understandingId = briefInputs.find((i: any) => i.role === 'source').artifactId
			const understood = await store.get(understandingId)
			expect(understood.payload.sourceArtifactId).toBe(
				incoming.artifacts.find((a: any) => a.typeKey === 'core.file').artifactId
			)
			const childInputs = studioObject(
				await store.client.producerInputs(scope!, understandingId)
			).inputs
			const invocation = await store.get(
				childInputs.find((i: any) => i.role === 'invocation').artifactId
			)
			expect(invocation.payload.skillArtifactId).toBe(child.published_artifact_id)
			const parentInvocation = await store.get(String(invocation.payload.parentInvocationId))
			expect(parentInvocation.payload.skillArtifactId).toBe(parent.published_artifact_id)
			expect((understood.payload.artifactIds as string[]).length).toBeGreaterThan(0)
			const inner = studioObject(
				await store.client.producerInputs(scope!, (understood.payload.artifactIds as string[])[0]!)
			)
			expect(inner.inputs).toContainEqual({
				role: 'invocation',
				ordinal: 0,
				artifactId: invocation.artifactId
			})
			const before = await store.highWater()
			await call('sample', capture)
			await Promise.all([call('sync'), call('sync')])
			expect((await store.highWater()).sequence).toBe(before.sequence)
			expect((await call('state')).runs).toHaveLength(2)
			const connection = state.connections.find((c: any) => c.id === sourceConnectionId)
			const paused = await call('control', {
				id: connection.id,
				revision: connection.revision,
				enabled: false
			})
			await call('sample', { requestId: randomUUID(), observedAt: new Date().toISOString() })
			expect((await call('state')).runs).toHaveLength(2)
			await runner.close()
			runner = new SqlPlanRunner(
				pool,
				pool,
				createStudioExecutor(store, {
					artifactsFor: () => ({
						client: store.client,
						scopeId: scope!,
						userId: security.principal.subjectId
					})
				})
			)
			service = new StudioService(pool, store, runner)
			await call('control', { id: paused.id, revision: paused.revision, enabled: true })
			state = await settle(4)
			expect(state.runs).toHaveLength(4)
		}, 60000)
		test('draft compare-and-swap, read-only enforcement, exact revisions and cross-user control fail closed', async () => {
			const d = await call('draft', {
				id: randomUUID(),
				revision: 0,
				definition: draftFor(file, brief)
			})
			const changed = { ...d.definition, name: 'Edited by the agent' }
			await call('draft', { id: d.id, revision: d.revision, definition: changed })
			await expect(
				call('draft', { id: d.id, revision: d.revision, definition: d.definition })
			).rejects.toThrow('changed')
			await expect(call('publish', { id: d.id, revision: d.revision })).rejects.toThrow('changed')
			await expect(call('sample', {}, true)).rejects.toThrow('write access')
			const other = { ...security, principal: { ...security.principal, subjectId: randomUUID() } }
			await expect(
				service.call({ operation: 'publish', data: { id: d.id, revision: 2 } }, other, {}, false)
			).rejects.toThrow('unavailable')
			const item = await call('publish', { id: d.id, revision: 2 })
			expect((await store.get(item.published_artifact_id)).payload.name).toBe(changed.name)
			await expect(
				call('connect', {
					id: randomUUID(),
					name: 'Loop',
					skillArtifactId: (await publish(draftFor(file, file))).published_artifact_id,
					sourceArtifactId: null,
					inputPort: 'source',
					fixedInputs: {},
					enabled: true
				})
			).rejects.toThrow('feedback loop')
		})
	}
)
