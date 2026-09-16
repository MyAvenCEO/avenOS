import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { describe, expect, test } from 'vitest'
import { composeAuthorizedStudioOperation } from '../src/lib/skills/studio-compose'

const capabilityId = 'ceo.aven:capability:fixture:inspect@1'
const source = {
	schema: 'fixture:source@1',
	type: { key: 'fixture.source', version: 1 },
	predicate: 'fixture.source(X)',
	role: 'source',
	cardinality: 'one' as const
}
const entry: StudioCatalogEntry = {
	actorId: 'ceo.aven:actor:fixture:worker@1',
	capabilityId,
	version: '1',
	installationDigest: 'a'.repeat(64),
	label: 'Inspect',
	description: 'Inspect an artifact.',
	tags: [],
	mode: 'observe',
	parametersSchema: {
		type: 'object',
		properties: {},
		required: [],
		additionalProperties: false
	},
	inputs: [{ name: 'source', ...source, sensitive: false }],
	outputs: [],
	requires: [source.predicate],
	produces: [],
	placements: ['server'],
	readiness: 'needs-input',
	reasonCodes: [],
	canAuthor: true,
	canPlan: true,
	canInvokeNow: false
}
const definition = {
	version: 2,
	name: 'Inspect things',
	inputs: {},
	parametersSchema: {
		type: 'object',
		properties: {},
		required: [],
		additionalProperties: false,
		maxProperties: 0
	},
	steps: [],
	outputs: {},
	policy: {
		maxInvocations: 8,
		maxDepth: 4,
		maxMembers: 32,
		maxConcurrentChildren: 2,
		allowModel: false
	}
}

function page(entries: StudioCatalogEntry[]): StudioCatalogPage {
	return {
		contractVersion: 1,
		catalogDigest: 'catalog',
		authorityContext: 'authority',
		viewToken: crypto.randomUUID(),
		capturedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		actors: [],
		actorVisibleCount: 0,
		entries,
		visibleCount: entries.length,
		totalVisibleCount: entries.length,
		readyVisibleCount: 0,
		nextCursor: null
	}
}

describe('agent Studio composition', () => {
	test('resolves the exact authorized operation and uses the shared visual wiring rule', async () => {
		const calls: Array<Record<string, unknown>> = []
		const result = await composeAuthorizedStudioOperation(
			definition,
			capabilityId,
			async <Value>(operation: string, data: Record<string, unknown>) => {
				expect(operation).toBe('catalog')
				calls.push(data)
				return page([entry]) as Value
			}
		)
		expect(calls[0]).toMatchObject({ search: capabilityId, readyOnly: false })
		expect(result.definition.inputs).toEqual({ source })
		expect(result.definition.steps[0]).toMatchObject({
			kind: 'invoke',
			capabilityId,
			inputs: { source: { kind: 'input', port: 'source' } }
		})
		expect(result.cues).toEqual([{ kind: 'new-input', name: 'source', from: 'source' }])
	})

	test('does not compose an unreturned, blocked or malformed capability', async () => {
		const request = async <Value>() => page([]) as Value
		await expect(
			composeAuthorizedStudioOperation(definition, capabilityId, request)
		).rejects.toThrow('STUDIO_OPERATION_NOT_VISIBLE')
		await expect(
			composeAuthorizedStudioOperation(definition, 'not-an-id', request)
		).rejects.toThrow('STUDIO_CAPABILITY_ID_INVALID')
		await expect(
			composeAuthorizedStudioOperation(
				definition,
				capabilityId,
				async <Value>() => page([{ ...entry, canAuthor: false }]) as Value
			)
		).rejects.toThrow('STUDIO_OPERATION_NOT_AUTHORABLE')
	})
})
