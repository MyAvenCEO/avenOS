import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import { combinedStudioCatalog, resetCombinedStudioCatalog } from '../src/lib/skills/studio-catalog'

const entry = (suffix: string): StudioCatalogEntry => ({
	actorId: `ceo.aven:actor:fixture.actor-${suffix}@1`,
	capabilityId: `ceo.aven:capability:fixture.actor-${suffix}:run@1`,
	version: '1',
	label: `Operation ${suffix}`,
	description: 'Fixture operation.',
	tags: [],
	mode: 'transform',
	parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
	inputs: [],
	outputs: [],
	requires: [],
	produces: [],
	placements: ['server'],
	readiness: 'ready',
	reasonCodes: [],
	canAuthor: true,
	canPlan: true,
	canInvokeNow: false
})

describe('combined native/server Studio catalog', () => {
	test('never reuses an environment-A page token after the authority changes to B', async () => {
		resetCombinedStudioCatalog()
		let authorityContext = 'environment-a-session-a'
		const remote = async <T>(): Promise<T> =>
			({
				contractVersion: 1,
				catalogDigest: 'same-visible-contracts',
				authorityContext,
				viewToken: crypto.randomUUID(),
				capturedAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				actors: [],
				actorVisibleCount: 0,
				entries: [entry('one'), entry('two')],
				visibleCount: 2,
				totalVisibleCount: 2,
				readyVisibleCount: 2,
				nextCursor: null
			}) as StudioCatalogPage as T
		const first = await combinedStudioCatalog({ limit: 1 }, remote)
		expect(first.nextCursor).toBe('1')
		authorityContext = 'environment-b-session-b'
		await expect(
			combinedStudioCatalog(
				{ limit: 1, cursor: first.nextCursor!, viewToken: first.viewToken },
				remote
			)
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
		const fresh = await combinedStudioCatalog({ limit: 1 }, remote)
		expect(fresh.authorityContext).not.toBe(first.authorityContext)
		resetCombinedStudioCatalog()
		await expect(
			combinedStudioCatalog(
				{ limit: 1, cursor: fresh.nextCursor!, viewToken: fresh.viewToken },
				remote
			)
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
	})

	test('invalidates a page when authorization readiness changes without a digest change', async () => {
		resetCombinedStudioCatalog()
		let canPlan = true
		const remote = async <T>(): Promise<T> => {
			const changed = { ...entry('one'), canPlan, readiness: canPlan ? 'ready' : 'needs-assurance' }
			return {
				contractVersion: 1,
				catalogDigest: 'same-contracts',
				authorityContext: 'same-session',
				viewToken: crypto.randomUUID(),
				capturedAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
				actors: [],
				actorVisibleCount: 0,
				entries: [changed, entry('two')],
				visibleCount: 2,
				totalVisibleCount: 2,
				readyVisibleCount: canPlan ? 2 : 1,
				nextCursor: null
			} as StudioCatalogPage as T
		}
		const first = await combinedStudioCatalog({ limit: 1 }, remote)
		canPlan = false
		await expect(
			combinedStudioCatalog(
				{ limit: 1, cursor: first.nextCursor!, viewToken: first.viewToken },
				remote
			)
		).rejects.toThrow('CATALOG_REFRESH_REQUIRED')
	})
})
