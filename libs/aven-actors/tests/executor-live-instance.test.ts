import { describe, expect, test } from 'bun:test'
import {
	Actor,
	type ActorAuthorizer,
	ActorRegistry,
	authorizeRegistryForPlanning,
	executePhysicalProgram,
	type RuntimeArtifact,
	type RuntimeStepPublication,
	solveAuthorized
} from '../src'

const sourceFact = 'fixture.source(X)'
const resultFact = 'fixture.result(X)'
const schemaIn = 'fixture:source@1'
const schemaOut = 'fixture:result@1'

function setup(denyInvoke = false) {
	const actor = new Actor(
		{
			id: 'normalizer',
			authority: 'ceo.aven',
			namespace: 'fixture',
			version: '1',
			name: 'Normalizer',
			description: 'Pure fixture transformation.',
			tags: [],
			methods: [
				{
					name: 'run',
					description: 'Normalize input.',
					parameters: { type: 'object' },
					mode: 'transform',
					idempotency: 'pure',
					requires: [sourceFact],
					produces: [resultFact],
					inputSlots: [
						{ name: 'source', predicate: sourceFact, schema: schemaIn, cardinality: 'one' }
					],
					outputSlots: [
						{ name: 'result', predicate: resultFact, schema: schemaOut, cardinality: 'one' }
					]
				}
			]
		},
		{
			run: (payload) => ({
				record: JSON.stringify({
					ok: true,
					outputs: {
						result: {
							sourceArtifactId: (payload.inputs as Record<string, { artifactId: string }>).source
								.artifactId,
							value: 'normalized'
						}
					}
				}),
				wire: 'done'
			})
		}
	)
	const registry = new ActorRegistry()
	registry.registerActor(actor)
	const principal = { subjectId: 'alice', kind: 'user' as const, assurance: ['passkey'] }
	const access = { tenantId: 'fixture-customer' }
	const calls: string[] = []
	const authorizer: ActorAuthorizer = {
		decide(request) {
			calls.push(request.action)
			return request.action === 'invoke' && denyInvoke
				? { allow: false, decisionId: 'deny', reasonCode: 'REVOKED' }
				: { allow: true, decisionId: `allow:${request.action}` }
		}
	}
	const original: RuntimeArtifact = {
		artifactId: 'committed-source',
		predicate: sourceFact,
		schema: schemaIn,
		typeKey: 'fixture.source',
		schemaVersion: 1,
		contentDigest: 'source-digest',
		value: { value: 'raw' }
	}
	const publications: RuntimeStepPublication[] = []
	const artifacts = {
		resolve: async (id: string) => (id === original.artifactId ? original : null),
		publish: async (publication: RuntimeStepPublication) => {
			publications.push(publication)
			return publication.outputs.map(
				(output, index): RuntimeArtifact => ({
					artifactId: `${publication.publicationId}:${index}`,
					predicate: output.predicate,
					schema: output.schema,
					typeKey: 'fixture.result',
					schemaVersion: 1,
					contentDigest: 'result-digest',
					value: output.value
				})
			)
		}
	}
	return { actor, registry, principal, access, authorizer, calls, artifacts, publications }
}

async function run(denyInvoke = false, wrongResolver = false) {
	const fixture = setup(denyInvoke)
	const snapshot = fixture.registry.snapshot()
	const view = await authorizeRegistryForPlanning(snapshot, fixture.principal, fixture.authorizer, {
		access: fixture.access
	})
	const plan = solveAuthorized(
		view,
		[{ predicate: sourceFact, artifactId: 'committed-source' }],
		[resultFact],
		{ executionEnvironment: 'local' }
	)
	if (!plan.ok) throw new Error(plan.reason)
	const wrong = wrongResolver ? setup().actor : null
	return {
		...fixture,
		plan: plan.program,
		execute: () =>
			executePhysicalProgram({
				runId: 'live-run',
				program: plan.program,
				registry: snapshot,
				principal: fixture.principal,
				access: fixture.access,
				authorizer: fixture.authorizer,
				factories: { resolve: () => undefined },
				instances: { resolve: () => wrong ?? fixture.actor },
				artifacts: fixture.artifacts
			})
	}
}

describe('trusted live Actor execution', () => {
	test('executes a planned instance with fresh invoke authorization and causal inputs', async () => {
		const fixture = await run()
		expect(fixture.plan.steps[0]?.target.kind).toBe('instance')
		const result = await fixture.execute()
		expect(result.fulfilledPredicates).toEqual([resultFact])
		expect(result.artifacts[0]?.value).toEqual({
			sourceArtifactId: 'committed-source',
			value: 'normalized'
		})
		expect(fixture.publications[0]?.inputs[0]?.artifact.artifactId).toBe('committed-source')
		expect(fixture.calls).toContain('invoke')
	})
	test('revocation or a different live object blocks publication', async () => {
		const revoked = await run(true)
		await expect(revoked.execute()).rejects.toThrow('invoke denied: REVOKED')
		expect(revoked.publications).toHaveLength(0)
		const substituted = await run(false, true)
		await expect(substituted.execute()).rejects.toThrow('trusted live actor')
		expect(substituted.publications).toHaveLength(0)
	})
})
