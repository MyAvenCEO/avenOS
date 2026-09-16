import { describe, expect, test } from 'bun:test'
import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { MessageBus } from '../src/lib/actors/bus'
import { StudioActor } from '../src/lib/actors/studio.actor'

const capabilityId = 'ceo.aven:capability:fixture:transform@1'
const source = {
	schema: 'fixture:source@1',
	type: { key: 'fixture.source', version: 1 },
	predicate: 'fixture.source(X)',
	role: 'source',
	cardinality: 'one' as const
}
const result = {
	schema: 'fixture:result@1',
	type: { key: 'fixture.result', version: 1 },
	predicate: 'fixture.result(X)',
	role: 'result',
	cardinality: 'one' as const
}
const entry: StudioCatalogEntry = {
	actorId: 'ceo.aven:actor:fixture:worker@1',
	capabilityId,
	version: '1',
	installationDigest: 'a'.repeat(64),
	label: 'Transform',
	description: 'Transform a fixture.',
	tags: [],
	mode: 'transform',
	parametersSchema: {
		type: 'object',
		properties: {},
		required: [],
		additionalProperties: false
	},
	inputs: [{ name: 'source', ...source, sensitive: false }],
	outputs: [{ name: 'result', ...result, sensitive: false }],
	requires: [source.predicate],
	produces: [result.predicate],
	placements: ['server'],
	readiness: 'needs-input',
	reasonCodes: [],
	canAuthor: true,
	canPlan: true,
	canInvokeNow: false
}

function catalogPage(): StudioCatalogPage {
	return {
		contractVersion: 1,
		catalogDigest: 'catalog',
		authorityContext: 'authority',
		viewToken: crypto.randomUUID(),
		capturedAt: new Date().toISOString(),
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		actors: [],
		actorVisibleCount: 0,
		entries: [entry],
		visibleCount: 1,
		totalVisibleCount: 1,
		readyVisibleCount: 0,
		nextCursor: null
	}
}

describe('Studio Actor v2 authoring parity', () => {
	test('an agent analyzes, creates, composes and semantically modifies a Skill', async () => {
		const calls: Array<{ operation: string; data: Record<string, unknown> }> = []
		const actor = new StudioActor(
			async <Value>(operation: string, data: Record<string, unknown>) => {
				calls.push({ operation, data })
				if (operation === 'catalog') return catalogPage() as Value
				if (operation === 'present')
					return {
						status: 'ready',
						title: 'Published Skill',
						steps: [{ label: 'Transform' }]
					} as Value
				throw new Error(`unexpected ${operation}`)
			}
		)
		const bus = new MessageBus()
		bus.register(actor)

		const analyzed = JSON.parse(
			(await bus.dispatch('agent', 'studio_present', { artifactId: crypto.randomUUID() })).record
		)
		expect(analyzed).toMatchObject({ status: 'ready', title: 'Published Skill' })

		const created = JSON.parse(
			(await bus.dispatch('agent', 'studio_new_definition', { name: 'Agent-built Skill' })).record
		)
		expect(created).toMatchObject({ version: 2, name: 'Agent-built Skill', steps: [] })

		const composed = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_compose_operation', {
					definition: created,
					capabilityId
				})
			).record
		)
		expect(composed.definition.steps[0]).toMatchObject({
			kind: 'invoke',
			capabilityId,
			inputs: { source: { kind: 'input', port: 'source' } }
		})

		const modified = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_edit_definition', {
					definition: composed.definition,
					edit: { kind: 'set-step-label', stepId: 'transform', label: 'Create final result' }
				})
			).record
		)
		expect(modified.change).toEqual({
			path: 'steps.transform.label',
			before: 'Transform',
			after: 'Create final result'
		})
		expect(modified.definition.steps[0].label).toBe('Create final result')
		expect(calls.map((call) => call.operation)).toEqual(['present', 'catalog'])
	})

	test('publishes closed semantic edit schemas and fails invalid edits without mutation', async () => {
		const actor = new StudioActor(async <Value>() => ({}) as Value)
		const editTool = actor.manifest.methods.find(
			(method) => method.name === 'studio_edit_definition'
		)
		if (!editTool) throw new Error('Missing semantic edit tool')
		const editSchema = (editTool.parameters.properties as Record<string, unknown>).edit as {
			oneOf: Array<Record<string, unknown>>
		}
		expect(editSchema.oneOf).toHaveLength(10)
		expect(editSchema.oneOf.every((variant) => variant.additionalProperties === false)).toBe(true)

		const bus = new MessageBus()
		bus.register(actor)
		const created = JSON.parse(
			(await bus.dispatch('agent', 'studio_new_definition', { name: 'Still safe' })).record
		)
		const refused = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_edit_definition', {
					definition: created,
					edit: { kind: 'rename', name: 'Unsafe', arbitraryCode: 'run()' }
				})
			).record
		)
		expect(refused).toMatchObject({ ok: false })
		expect(created.name).toBe('Still safe')
	})
})
