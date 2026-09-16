import { describe, expect, test } from 'bun:test'
import {
	ActorRegistry,
	StudioCatalog,
	TrustedActorInstallations,
	actorCatalogDigest,
	selectedActorContractDigest,
	definitionFromManifest,
	type ActorAuthorizer,
	type ActorInstallationDescriptor,
	type ActorRegistrySnapshot
} from '../src'

const principal = {
	subjectId: 'alice',
	kind: 'user' as const,
	assurance: ['passkey'],
	sessionId: 's1'
}
const access = { tenantId: 'customer-a' }
const emptyParameters = { type: 'object', properties: {}, additionalProperties: false }

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
				parameters: emptyParameters,
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
				parameters: emptyParameters,
				mode: 'view',
				idempotency: 'pure'
			},
			{
				name: 'hidden',
				description: 'Secret operation.',
				parameters: emptyParameters,
				mode: 'effect',
				idempotency: 'none'
			},
			{
				name: 'incomplete',
				description: 'Needs a port contract.',
				parameters: emptyParameters,
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
	const flow = actors.registerManifest({
		id: 'listener',
		authority: 'os.aven',
		namespace: 'voice',
		version: '1',
		name: 'Listener',
		description: 'Emits bounded speech events.',
		tags: ['voice'],
		methods: [],
		produces: ['utterance(T)']
	})
	actors.advertiseInstance({
		instanceId: 'listener-instance',
		definitionRef: flow.ref,
		label: 'Listener',
		address: { kind: 'local', value: 'private-listener' },
		capabilityIds: [],
		status: 'available',
		executionEnvironment: 'local'
	})
	return actors
}

async function trustedInstallation(snapshot: ActorRegistrySnapshot, fill = 'a') {
	const definition = snapshot.definitions.find((item) => item.manifest.id === 'fixture')!
	const digest = fill.repeat(64)
	const descriptor: ActorInstallationDescriptor = {
		packageId: 'ceo.aven:package:catalog:fixture@1',
		manifest: structuredClone(definition.manifest),
		placements: ['local'],
		schemas: [
			{
				schema: 'fixture:input@1',
				typeKey: 'fixture.input',
				typeVersion: 1,
				projectorDigest: digest
			},
			{
				schema: 'fixture:output@1',
				typeKey: 'fixture.output',
				typeVersion: 1,
				projectorDigest: digest
			}
		],
		procedures: definition.capabilities
			.filter((capability) => capability.method !== 'open_view')
			.map((capability) => ({
				capabilityId: capability.id,
				procedureKey: `fixture.${capability.method}`,
				procedureVersion: '1',
				implementationDigest: digest,
				evidenceRuleDigest: digest,
				requiredFeatures: ['named-results@1']
			}))
	}
	return await new TrustedActorInstallations().install(descriptor)
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
		const installation = await trustedInstallation(snapshot)
		const page = await new StudioCatalog().page({
			registry: snapshot,
			principal,
			access,
			authorizer,
			installationFor: (actorId) =>
				actorId === installation.definition.ref ? installation : undefined
		})
		expect(page.visibleCount).toBe(3)
		expect(page.actors).toContainEqual(
			expect.objectContaining({
				label: 'Listener',
				kind: 'event-flow',
				visibleOperationCount: 0,
				placements: ['local'],
				canCompose: false
			})
		)
		expect(JSON.stringify(page.actors)).not.toContain('private-listener')
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
		expect(observe.inputs[0]).toMatchObject({
			schema: 'fixture:input@1',
			type: { key: 'fixture.input', version: 1 },
			sensitive: false
		})
		const supported = await new StudioCatalog().page({
			registry: snapshot,
			principal,
			access,
			authorizer,
			installationFor: (actorId) =>
				actorId === installation.definition.ref ? installation : undefined,
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
		const anotherSession = await new StudioCatalog(() => new Date('2026-09-16T12:00:00Z')).page({
			registry: registry().snapshot(),
			principal: { ...principal, sessionId: 's2' },
			access,
			authorizer,
			limit: 1
		})
		expect(anotherSession.authorityContext).not.toBe(first.authorityContext)
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

	test('does not return a cached page after discover authority or assurance changes', async () => {
		const catalog = new StudioCatalog(() => new Date('2026-09-16T12:00:00Z'))
		let revoked = false
		const changingAuthorizer: ActorAuthorizer = {
			decide(request) {
				if (revoked && request.action === 'discover' && request.capabilityId?.includes(':observe@'))
					return { allow: false, decisionId: 'revoked', reasonCode: 'REVOKED' }
				return authorizer.decide(request)
			}
		}
		const first = await catalog.page({
			registry: registry().snapshot(),
			principal,
			access,
			authorizer: changingAuthorizer,
			limit: 1
		})
		await expect(
			catalog.page({
				registry: registry().snapshot(),
				principal: { ...principal, assurance: [] },
				access,
				authorizer: changingAuthorizer,
				limit: 1,
				cursor: first.nextCursor!,
				viewToken: first.viewToken
			})
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
		revoked = true
		await expect(
			catalog.page({
				registry: registry().snapshot(),
				principal,
				access,
				authorizer: changingAuthorizer,
				limit: 1,
				cursor: first.nextCursor!,
				viewToken: first.viewToken
			})
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
	})

	test('pages ready methods server-side without hiding the permitted blocked count', async () => {
		const catalog = new StudioCatalog(() => new Date('2026-09-16T12:00:00Z'))
		const snapshot = registry().snapshot()
		const installation = await trustedInstallation(snapshot)
		const input = {
			registry: snapshot,
			principal,
			access,
			authorizer,
			installationFor: (actorId: string) =>
				actorId === installation.definition.ref ? installation : undefined,
			runtimeSupports: (_actorId: string, capabilityId: string) =>
				capabilityId.includes(':open_view@')
		}
		const ready = await catalog.page({ ...input, readyOnly: true, limit: 1 })
		expect(ready.visibleCount).toBe(1)
		expect(ready.readyVisibleCount).toBe(1)
		expect(ready.totalVisibleCount).toBe(3)
		expect(ready.entries[0]?.mode).toBe('view')
		await expect(
			catalog.page({
				...input,
				readyOnly: false,
				limit: 1,
				viewToken: ready.viewToken,
				cursor: '0'
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
						parameters: emptyParameters,
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
		const selected = actors.snapshot().definitions[0]!.capabilities[0]!.id
		const route = await selectedActorContractDigest(actors.snapshot(), [selected])
		actors.withdrawInstance('local-instance')
		expect(await actorCatalogDigest(actors.snapshot())).toBe(first)
		expect(await selectedActorContractDigest(actors.snapshot(), [selected])).toBe(route)
		actors.registerDefinition(
			definitionFromManifest({
				id: 'unrelated',
				authority: 'ceo.aven',
				namespace: 'catalog',
				version: '1',
				name: 'Unrelated',
				description: 'Different work',
				tags: [],
				methods: [
					{
						name: 'other',
						description: 'Other operation',
						parameters: emptyParameters,
						mode: 'view',
						idempotency: 'pure'
					}
				]
			})
		)
		expect(await selectedActorContractDigest(actors.snapshot(), [selected])).toBe(route)
		expect(await actorCatalogDigest(actors.snapshot())).not.toBe(first)
	})

	test('visible catalog identity includes trusted projector and implementation descriptors', async () => {
		const snapshot = registry().snapshot()
		const base = { registry: snapshot, principal, access, authorizer }
		const oldInstallation = await trustedInstallation(snapshot, 'a')
		const updatedInstallation = await trustedInstallation(snapshot, 'b')
		const old = await new StudioCatalog().page({
			...base,
			installationFor: (actorId) =>
				actorId === oldInstallation.definition.ref ? oldInstallation : undefined
		})
		const updated = await new StudioCatalog().page({
			...base,
			installationFor: (actorId) =>
				actorId === updatedInstallation.definition.ref ? updatedInstallation : undefined
		})
		expect(updated.catalogDigest).not.toBe(old.catalogDigest)
		expect(old.entries[0]?.installationDigest).toBe(oldInstallation.digest)
		const absent = await new StudioCatalog().page({
			...base,
			installationFor: () => undefined,
			runtimeSupports: () => true
		})
		expect(absent.entries.every((entry) => !entry.canAuthor && !entry.canPlan)).toBe(true)
		expect(
			absent.entries.every((entry) => entry.reasonCodes.includes('INSTALLATION_UNAVAILABLE'))
		).toBe(true)
		const mismatched = {
			...oldInstallation,
			definition: {
				...oldInstallation.definition,
				manifest: { ...oldInstallation.definition.manifest, description: 'Different contract' }
			}
		}
		const rejected = await new StudioCatalog().page({
			...base,
			installationFor: () => mismatched
		})
		expect(rejected.entries.every((entry) => !entry.installationDigest)).toBe(true)
		expect(
			rejected.entries.every((entry) => entry.reasonCodes.includes('INSTALLATION_UNAVAILABLE'))
		).toBe(true)
		expect(rejected.entries.flatMap((entry) => entry.inputs).every((port) => !port.type)).toBe(
			true
		)
	})

	test('rejects different content under an installed version without changing the snapshot', () => {
		const actors = registry()
		const before = actors.snapshot()
		const original = before.definitions[0]!
		actors.registerDefinition(structuredClone(original))
		expect(actors.snapshot().revision).toBe(before.revision)
		expect(() =>
			actors.registerDefinition({
				...structuredClone(original),
				manifest: {
					...structuredClone(original.manifest),
					methods: original.manifest.methods.map((method, index) =>
						index === 0
							? { ...structuredClone(method), description: 'Changed in place' }
							: structuredClone(method)
					)
				}
			})
		).toThrow('ACTOR_CONTRACT_IDENTITY_CONFLICT')
		expect(actors.snapshot().revision).toBe(before.revision)
		expect(actors.snapshot().definitions[0]).toEqual(original)
	})
})
