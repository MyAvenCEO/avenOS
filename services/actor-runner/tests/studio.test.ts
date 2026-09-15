import { randomUUID } from 'node:crypto'
import {
	ACTOR_RUN_PROTOCOL,
	type PlanRunSecurityContext,
	type PlanRunStartRequest
} from '@avenos/actors'
import { compileStudio, draftFor, STUDIO_SKILL } from '@avenos/actors/studio'
import type pg from 'pg'
import { describe, expect, test, vi } from 'vitest'
import { MemoryPlanRunner } from '../src/memory-runner'
import { StudioArtifacts, studioIdentity, studioPlanDigest } from '../src/studio-artifacts'
import { createStudioExecutor } from '../src/studio-executor'
import { StudioService } from '../src/studio-service'
import { studioStoreFixture } from './support/studio-store'

const file = { key: 'core.file', version: 1 }
const understanding = { key: 'studio.understanding', version: 1 }
const brief = { key: 'studio.brief', version: 1 }
function fixture() {
	const wire = studioStoreFixture()
	const store = new StudioArtifacts(wire.client, wire.scope)
	const security: PlanRunSecurityContext = {
		principal: { subjectId: randomUUID(), kind: 'user', assurance: ['passkey'] },
		access: { tenantId: wire.scope },
		establishedBy: 'studio-test',
		authorizedAt: new Date().toISOString()
	}
	const execute = createStudioExecutor(store, {
		artifactsFor: () => ({
			client: wire.client,
			scopeId: wire.scope,
			userId: security.principal.subjectId
		})
	})
	const runner = new MemoryPlanRunner(execute)
	const query = vi.fn(() => {
		throw new Error('Read-only planning must not touch mutable storage')
	})
	const service = new StudioService({ query } as unknown as pg.Pool, store, runner)
	const publish = (
		type: string,
		payload: unknown,
		options: {
			parameters?: unknown
			bytes?: Uint8Array
			inputs?: Array<{ role: string; id: string }>
		} = {}
	) =>
		store.publish({
			id: randomUUID(),
			procedure: 'studio.test',
			principal: security.principal.subjectId,
			parameters: options.parameters ?? {},
			inputs: options.inputs ?? [],
			artifacts: [{ key: 'value', type, payload, bytes: options.bytes }]
		})
	return { ...wire, store, security, execute, service, publish, query }
}
async function prepared() {
	const f = fixture()
	const [source] = await f.publish(
		'core.file',
		{ originalName: 'note.txt', declaredMediaType: 'text/plain', sourceKind: 'test' },
		{ bytes: new TextEncoder().encode('A project note.\nReview the design on Thursday.\n') }
	)
	const [child] = await f.publish('studio.skill', draftFor(file, understanding))
	const definition = draftFor(file, understanding, 'Parent')
	definition.steps = ['first', 'second'].map((id) => ({
		id,
		kind: 'skill',
		label: id,
		ref: child!.artifactId,
		inputs: { source: { kind: 'input', name: 'source' } },
		parameters: {}
	}))
	definition.output.from = { kind: 'step', name: 'second' }
	const [parent] = await f.publish('studio.skill', definition)
	const activate = async () => {
		const activationId = randomUUID()
		const [activation] = await f.publish(
			'studio.activation',
			{
				activationId,
				initiator: f.security.principal.subjectId,
				skillArtifactId: parent!.artifactId,
				inputs: { source: source!.artifactId },
				origin: 'manual',
				subscriptionArtifactId: null
			},
			{
				parameters: {
					catalogRevision: 'studio-v1',
					planSha256: studioPlanDigest(
						compileStudio(definition, await f.store.library([parent!.artifactId]))
					)
				},
				inputs: [
					{ role: 'program', id: parent!.artifactId },
					{ role: 'source', id: source!.artifactId }
				]
			}
		)
		const request: PlanRunStartRequest = {
			protocol: ACTOR_RUN_PROTOCOL,
			skillRef: STUDIO_SKILL,
			executionEnvironment: 'server',
			requestId: activationId,
			idempotencyKey: activationId,
			requestedAt: activation!.committedAt,
			parameters: { activationArtifactId: activation!.artifactId },
			ingredients: [],
			goals: [],
			security: f.security
		}
		return { request, activation: activation! }
	}
	return { ...f, source: source!, parent: parent!, child: child!, activate }
}
describe('Studio application', () => {
	test('preview and what-if comparison have no publications, writes or model calls', async () => {
		const f = fixture()
		const baseline = draftFor(file, brief)
		const variant = { ...baseline, policy: { ...baseline.policy, maxInvocations: 1 } }
		expect(
			await f.service.call(
				{ operation: 'compare', data: { baseline, variants: [variant] } },
				f.security,
				{},
				true
			)
		).toMatchObject({ mode: 'planning-only', baseline: { ok: true }, variants: [{ ok: false }] })
		expect(f.query).not.toHaveBeenCalled()
		expect(f.publications.size).toBe(0)
		await expect(
			f.service.call({ operation: 'sample', data: {} }, f.security, {}, true)
		).rejects.toThrow('write access')
	})
	test('nested real document calls retain activation, parent, child and evidence provenance', async () => {
		const f = await prepared()
		const { request, activation } = await f.activate()
		const result = await f.execute(request)
		expect(result.artifactIds).toHaveLength(1)
		const output = await f.store.get(result.artifactIds![0]!)
		expect(output.typeKey).toBe('studio.understanding')
		const invocations = [...f.artifacts.values()].filter((a) => a.typeKey === 'studio.invocation')
		expect(invocations.map((a) => a.payload.callPath)).toEqual([
			'root',
			'root/first',
			'root/second'
		])
		expect(invocations[1].payload.parentInvocationId).toBe(invocations[0].artifactId)
		expect(invocations[2].payload.parentInvocationId).toBe(invocations[0].artifactId)
		const documents = [...f.publications.values()].filter(
			(p) => p.run.procedureVersion === 'server-v1'
		)
		expect(documents.length).toBeGreaterThanOrEqual(2)
		for (const p of documents) {
			expect(p.run.inputs).toContainEqual({
				role: 'activation',
				ordinal: 0,
				artifactId: activation.artifactId
			})
			expect(p.run.inputs).toContainEqual({
				role: 'program',
				ordinal: 0,
				artifactId: f.child.artifactId
			})
			expect(
				p.run.inputs.some(
					(i: any) =>
						i.role === 'invocation' &&
						[invocations[1].artifactId, invocations[2].artifactId].includes(i.artifactId)
				)
			).toBe(true)
		}
		const count = f.artifacts.size
		const replayed = await f.execute(request)
		expect(replayed.artifactIds).toEqual(result.artifactIds)
		expect(f.artifacts.size).toBe(count)
		const second = await f.activate()
		const rerun = await f.execute(second.request)
		expect(rerun.artifactIds).not.toEqual(result.artifactIds)
	})
	test('a lost document acknowledgement reuses the committed stage on retry', async () => {
		const f = await prepared()
		const { request } = await f.activate()
		f.failNextAcknowledgement('client.inspect-file')
		await expect(f.execute(request)).rejects.toThrow('lost acknowledgement')
		const before = [...f.publications.values()]
			.filter((p) => p.run.procedureVersion === 'server-v1')
			.map((p) => p.publication.publicationId)
		await f.execute(request)
		for (const id of before) expect(f.publications.has(id)).toBe(true)
		expect(new Set([...f.publications.keys()]).size).toBe(f.publications.size)
	})
	test('high-water uses the query snapshot, and identities are scoped and tuple-safe', async () => {
		const f = fixture()
		expect((await f.store.highWater()).sequence).toBe(0)
		await f.publish('studio.skill', draftFor(file, brief))
		expect((await f.store.highWater()).sequence).toBe(1)
		expect(await studioIdentity('a', 'b:c', 'd')).not.toBe(await studioIdentity('a', 'b', 'c:d'))
		expect(await studioIdentity('a', 'b')).not.toBe(await studioIdentity('c', 'b'))
		expect(studioPlanDigest({ b: { z: 2, a: 1 }, a: 0 })).toBe(
			studioPlanDigest({ a: 0, b: { a: 1, z: 2 } })
		)
	})
	test('a subscription retry preserves arrivals between artifact publication and a failed database insert', async () => {
		const f = fixture()
		const [skill] = await f.publish('studio.skill', draftFor(file, brief))
		const initial = await f.store.highWater()
		let failInsert = true
		let checkpoint: unknown
		const database = {
			query: async (sql: string, values: unknown[]) => {
				if (sql.includes('count(*)')) return { rows: [{ count: 0 }] }
				if (sql.startsWith('SELECT')) return { rows: [] }
				if (sql.startsWith('INSERT INTO studio_connections')) {
					if (failInsert) {
						failInsert = false
						throw new Error('Synthetic database interruption')
					}
					checkpoint = values[6]
					return { rowCount: 1, rows: [{ id: values[0] }] }
				}
				throw new Error('Unexpected statement')
			}
		} as unknown as pg.Pool
		const service = new StudioService(database, f.store, new MemoryPlanRunner())
		const command = {
			operation: 'connect',
			data: {
				id: randomUUID(),
				name: 'Recoverable connection',
				skillArtifactId: skill!.artifactId,
				sourceArtifactId: null,
				inputPort: 'source',
				fixedInputs: {},
				enabled: true
			}
		}
		await expect(service.call(command, f.security, {}, false)).rejects.toThrow(
			'database interruption'
		)
		await f.publish(
			'core.file',
			{ originalName: 'arrived-during-outage.txt', declaredMediaType: 'text/plain' },
			{ bytes: new TextEncoder().encode('Keep this arrival.') }
		)
		expect((await f.store.highWater()).sequence).toBeGreaterThan(initial.sequence)
		await service.call(command, f.security, {}, false)
		expect(checkpoint).toBe(initial.sequence)
	})
	test('changed admitted resolution cannot silently execute a replacement plan', async () => {
		const f = await prepared()
		const { request, activation } = await f.activate()
		f.publications.get(activation.publicationId).run.parameters.planSha256 = '0'.repeat(64)
		await expect(f.execute(request)).rejects.toThrow('changed since admission')
		expect([...f.artifacts.values()].filter((a) => a.typeKey === 'studio.invocation')).toHaveLength(
			0
		)
	})
	test('rejects cross-scope artifact reads and forged request security', async () => {
		const f = await prepared()
		const { request } = await f.activate()
		await expect(
			new StudioArtifacts(f.client, randomUUID()).get(f.source.artifactId)
		).rejects.toThrow()
		await expect(
			f.execute({
				...request,
				security: { ...f.security, principal: { ...f.security.principal, subjectId: randomUUID() } }
			})
		).rejects.toThrow('activation')
		await expect(
			f.service.call(
				{ operation: 'preview', data: { definition: draftFor(file, brief), security: f.security } },
				f.security,
				{},
				true
			)
		).rejects.toThrow()
	})
})
