import { describe, expect, test } from 'vitest'
import { StudioCatalog, type PlanRunSecurityContext } from '@avenos/actors'
import { createDocumentCatalogSource } from '../src/document-catalog.js'

const scope = 'customer-a'
const security: PlanRunSecurityContext = {
	principal: { subjectId: 'alice', kind: 'user', assurance: ['passkey'], sessionId: 's1' },
	access: { tenantId: scope }, establishedBy: 'test-boundary',
	authorizedAt: '2026-09-16T12:00:00Z'
}

describe('production document Studio inventory policy', () => {
	test('discovers release-owned methods but never advertises generic execution', async () => {
		const source = createDocumentCatalogSource(scope)
		const registry = await source.registry()
		const authorizer = await source.authorizer(security)
		expect(registry.definitions).toHaveLength(18)
		expect(registry.instances).toHaveLength(0)
		expect(registry.offers).toHaveLength(0)
		const page = await new StudioCatalog().page({
			registry, authorizer, principal: security.principal, access: security.access,
			installationFor: source.installationFor,
			runtimeSupports: source.runtimeSupports
		})
		expect(page.visibleCount).toBe(18)
		expect(page.actorVisibleCount).toBe(18)
		expect(page.actors.every((actor) => actor.kind === 'operations' &&
			actor.visibleOperationCount === 1)).toBe(true)
		expect(page.readyVisibleCount).toBe(0)
		expect(page.entries.every((entry) => entry.readiness === 'contract-incomplete')).toBe(true)
		expect(page.entries.every((entry) => entry.reasonCodes.includes('INSTALLATION_UNAVAILABLE')))
			.toBe(true)
		expect(page.entries.every((entry) => !entry.canAuthor && !entry.canPlan &&
			!entry.canInvokeNow)).toBe(true)
		const capability = registry.definitions[0]!.capabilities[0]!
		const plan = await authorizer.decide({ action: 'plan', principal: security.principal,
			access: security.access, definitionRef: registry.definitions[0]!.ref,
			capabilityId: capability.id })
		expect(plan.allow).toBe(false)
		const ready = await new StudioCatalog().page({
			registry, authorizer, principal: security.principal, access: security.access,
			readyOnly: true, installationFor: source.installationFor,
			runtimeSupports: source.runtimeSupports
		})
		expect(ready.entries).toEqual([])
		expect(ready.totalVisibleCount).toBe(18)
	})

	test('a different customer or unauthenticated principal cannot enumerate the package', async () => {
		const source = createDocumentCatalogSource(scope)
		const registry = await source.registry()
		const authorizer = await source.authorizer(security)
		const page = await new StudioCatalog().page({ registry, authorizer,
			principal: { ...security.principal, kind: 'anonymous' },
			access: security.access,
			installationFor: source.installationFor })
		expect(page.visibleCount).toBe(0)
		expect(page.actorVisibleCount).toBe(0)
		const other = await new StudioCatalog().page({ registry, authorizer,
			principal: security.principal, access: { tenantId: 'customer-b' },
			installationFor: source.installationFor })
		expect(other.visibleCount).toBe(0)
	})
})
