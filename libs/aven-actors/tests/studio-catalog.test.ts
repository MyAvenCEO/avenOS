import { describe, expect, test } from 'bun:test'
import {
	ActorRegistry,
	StudioCatalog,
	actorCatalogDigest,
	definitionFromManifest,
	type ActorAuthorizer
} from '../src'

const principal = {
	subjectId: 'alice',
	kind: 'user' as const,
	assurance: ['passkey'],
	sessionId: 's1'
}
const access = { tenantId: 'customer-a' }

function registry() {
	const actors = new ActorRegistry(() => new Date('2026-09-16T12:00:00Z'))
	const definition = definitionFromManifest({
		id: 'fixture',
		authority: 'ceo.aven',
		namespace: 'catalog',
		version: '1',
		name: 'Fixture',
		description: 'Catalog fixture',
		tags: ['test'],
		methods: [
			{
				name: 'observe',
				description: 'Find two outcomes.',
				parameters: { type: 'object' },
				mode: 'observe',
				idempotency: 'pure',
				requires: ['fixture.input(X)'],
				produces: ['fixture.output(X)'],
				inputSlots: [
					{
						name: 'source',
						predicate: 'fixture.input(X)',
						schema: 'fixture:input@1',
						role: 'source',
						cardinality: 'one'
					}
				],
				outputSlots: [
					{
						name: 'result',
						predicate: 'fixture.output(X)',
						schema: 'fixture:output@1',
						role: 'result',
						cardinality: 'one'
					}
				]
			},
			{
				name: 'open_view',
				description: 'Show current state.',
				parameters: { type: 'object' },
				mode: 'view',
				idempotency: 'pure'
			},
			{
				name: 'hidden',
				description: 'Secret operation.',
				parameters: { type: 'object' },
				mode: 'effect',
				idempotency: 'none'
			},
			{
				name: 'incomplete',
				description: 'Needs a port contract.',
				parameters: { type: 'object' },
				requires: ['fixture.input(X)'],
				produces: ['fixture.other(X)']
			}
		]
	})
	actors.registerDefinition(definition)
	actors.advertiseInstance({
		instanceId: 'local-instance',
		definitionRef: definition.ref,
		label: 'Fixture',
		address: { kind: 'local', value: 'private-address' },
		capabilityIds: definition.capabilities.map((capability) => capability.id),
		status: 'available',
		executionEnvironment: 'local'
	})
	return actors
}

const authorizer: ActorAuthorizer = {
	decide(request) {
		if (request.capabilityId?.includes(':hidden@'))
			return { allow: false, decisionId: 'hidden', reasonCode: 'HIDDEN' }
		return { allow: true, decisionId: `allowed:${request.action}` }
	}
}

describe('authorized Studio catalog', () => {
	test('keeps zero-output methods discoverable without inventing proof facts', async () => {
		const snapshot = registry().snapshot()
		const page = await new StudioCatalog().page({
			registry: snapshot,
			principal,
			access,
			authorizer
		})
		expect(page.visibleCount).toBe(3)
		expect(page.entries.some((entry) => entry.capabilityId.includes(':hidden@'))).toBe(false)
		const view = page.entries.find((entry) => entry.capabilityId.includes(':open_view@'))!
		expect(view.produces).toEqual([])
		expect(view.readiness).toBe('unsupported-runtime')
		const incomplete = page.entries.find((entry) => entry.capabilityId.includes(':incomplete@'))!
		expect(incomplete.readiness).toBe('contract-incomplete')
		expect(incomplete.canInvokeNow).toBe(false)
		const observe = page.entries.find((entry) => entry.capabilityId.includes(':observe@'))!
		expect(observe.readiness).toBe('unsupported-runtime')
		expect(observe.canPlan).toBe(false)
		const supported = await new StudioCatalog().page({
			registry: snapshot,
			principal,
			access,
			authorizer,
			runtimeSupports: (_, capabilityId) => capabilityId === observe.capabilityId
		})
		expect(
			supported.entries.find((entry) => entry.capabilityId === observe.capabilityId)
		).toMatchObject({ readiness: 'needs-input', canPlan: true, canInvokeNow: false })
		expect(supported.catalogDigest).toBe(page.catalogDigest)
		expect(JSON.stringify(page)).not.toContain('private-address')
	})

	test('partitions pagination by subject and binds it to one authorized snapshot', async () => {
		const catalog = new StudioCatalog(() => new Date('2026-09-16T12:00:00Z'))
		const first = await catalog.page({
			registry: registry().snapshot(),
			principal,
			access,
			authorizer,
			limit: 1
		})
		expect(first.entries).toHaveLength(1)
		const second = await catalog.page({
			registry: registry().snapshot(),
			principal,
			access,
			authorizer,
			limit: 1,
			cursor: first.nextCursor!,
			viewToken: first.viewToken
		})
		expect(second.entries[0]?.capabilityId).not.toBe(first.entries[0]?.capabilityId)
		expect(second.catalogDigest).toBe(first.catalogDigest)
		await expect(
			catalog.page({
				registry: registry().snapshot(),
				principal: { ...principal, subjectId: 'bob' },
				access,
				authorizer,
				cursor: first.nextCursor!,
				viewToken: first.viewToken
			})
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
		await expect(
			catalog.page({
				registry: registry().snapshot(),
				principal,
				access,
				authorizer,
				search: 'changed',
				cursor: first.nextCursor!,
				viewToken: first.viewToken
			})
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
	})

	test('visible digest is not a change oracle for hidden Actor contracts', async () => {
		const actors = registry()
		const first = await new StudioCatalog().page({
			registry: actors.snapshot(),
			principal,
			access,
			authorizer
		})
		actors.registerDefinition(
			definitionFromManifest({
				id: 'private',
				authority: 'ceo.aven',
				namespace: 'catalog',
				version: '1',
				name: 'Private',
				description: 'Private only',
				tags: [],
				methods: [
					{
						name: 'hidden',
						description: 'Never visible',
						parameters: { type: 'object' },
						mode: 'view',
						idempotency: 'pure'
					}
				]
			})
		)
		const second = await new StudioCatalog().page({
			registry: actors.snapshot(),
			principal,
			access,
			authorizer
		})
		expect(second.visibleCount).toBe(first.visibleCount)
		expect(second.catalogDigest).toBe(first.catalogDigest)
	})

	test('descriptor digest survives revision and availability changes', async () => {
		const actors = registry()
		const first = await actorCatalogDigest(actors.snapshot())
		actors.withdrawInstance('local-instance')
		expect(await actorCatalogDigest(actors.snapshot())).toBe(first)
	})
})
