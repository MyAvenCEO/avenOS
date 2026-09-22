import { describe, expect, test } from 'bun:test'
import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { parseStudioCase, type StudioCase, simulateStudioCase } from '@avenos/actors/studio/case'
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
	invocationStatus: 'not-evaluated'
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

// Transport contract fixture only; live model behavior is verified by live-studio-workday.ts.
function draftTransport() {
	const drafts = new Map<string, { id: string; revision: number; definition: any }>()
	const request = async <Value>(operation: string, data: Record<string, unknown>) => {
		if (operation === 'catalog') return catalogPage() as Value
		if (operation === 'state')
			return { drafts: [...drafts.values()].map((draft) => structuredClone(draft)) } as Value
		if (operation === 'draft') {
			const id = String(data.id)
			if ((drafts.get(id)?.revision ?? 0) !== data.revision) throw Error('Draft conflict')
			const saved = {
				id,
				revision: Number(data.revision) + 1,
				definition: structuredClone(data.definition)
			}
			drafts.set(id, saved)
			return structuredClone(saved) as Value
		}
		if (operation === 'present') return { status: 'ready', title: 'Published Skill' } as Value
		throw Error(`Unexpected operation ${operation}`)
	}
	return { request, drafts }
}

describe('Studio Actor v2 authoring parity', () => {
	test('a rejected output edit reports its path and can be corrected without losing the composed definition', async () => {
		const { request, drafts } = draftTransport()
		const actor = new StudioActor(request)
		const bus = new MessageBus()
		bus.register(actor)
		const call = async (name: string, data: Record<string, unknown>) =>
			JSON.parse((await bus.dispatch('agent', name, data)).record)
		const id = crypto.randomUUID()
		await call('studio_author', {
			id,
			revision: 0,
			action: { kind: 'create', name: 'Document index' }
		})
		const composed = await call('studio_author', {
			id,
			revision: 1,
			action: { kind: 'operation', capabilityId }
		})
		const before = JSON.stringify(drafts.get(id))
		expect(composed.steps[0].after).toEqual([])
		const misplacedRevision = await call('studio_author', {
			id,
			revision: 2,
			action: { kind: 'edit', id, revision: 2, edits: [{ kind: 'rename', name: 'Must not save' }] }
		})
		expect(misplacedRevision.error).toContain('Unknown action fields: id, revision')
		expect(JSON.stringify(drafts.get(id))).toBe(before)
		const from = { kind: 'step', stepId: composed.steps[0].id, port: 'result' }
		const rejected = await call('studio_author', {
			id,
			revision: 2,
			action: { kind: 'edit', edits: [{ kind: 'set-output', name: 'index', output: from }] }
		})
		expect(rejected).toMatchObject({ ok: false })
		expect(JSON.stringify(drafts.get(id))).toBe(before)
		const fixed = await call('studio_author', {
			id,
			revision: 2,
			action: {
				kind: 'edit',
				edits: [
					{ kind: 'expose-output', name: 'index', stepId: composed.steps[0].id, port: 'result' }
				]
			}
		})
		expect(fixed.outputs.index.from).toEqual(from)
		expect(fixed.revision).toBe(3)
		expect(fixed.published).toBe(false)
		const ordered = await call('studio_author', {
			id,
			revision: 3,
			action: { kind: 'operation', capabilityId }
		})
		const dependent = await call('studio_author', {
			id,
			revision: 4,
			action: {
				kind: 'edit',
				edits: [
					{
						kind: 'set-after',
						stepId: ordered.steps[1].id,
						after: [ordered.steps[0].id]
					}
				]
			}
		})
		expect(dependent.steps[1].after).toEqual([ordered.steps[0].id])
	})
	test('agent can propose, inspect, revise and rehearse a case but has no confirmation tool', async () => {
		const records = new Map<
			string,
			{
				artifactId: string
				payload: { case: StudioCase; status: string; predecessorArtifactId: unknown }
			}
		>()
		const actor = new StudioActor(
			async <Value>(operation: string, data: Record<string, unknown>) => {
				if (operation === 'case-propose') {
					const record = {
						artifactId: crypto.randomUUID(),
						payload: {
							case: parseStudioCase(data.case),
							status: 'proposed',
							predecessorArtifactId: data.predecessorArtifactId ?? null
						}
					}
					records.set(record.artifactId, record)
					return record as Value
				}
				if (operation === 'inspect')
					return { artifact: records.get(String(data.artifactId)) } as Value
				if (operation === 'case-what-if') {
					const record = records.get(String(data.artifactId))
					if (!record) throw Error('Missing case')
					return simulateStudioCase(record.payload.case) as Value
				}
				throw Error('Unexpected operation')
			}
		)
		const bus = new MessageBus()
		bus.register(actor)
		const call = async (name: string, data: Record<string, unknown>) =>
			JSON.parse((await bus.dispatch('agent', name, data)).record)
		const example: StudioCase = {
			title: 'Remembered task',
			situation: 'An email arrived',
			outcome: 'A useful brief',
			evidence: [
				{
					id: 'memory',
					kind: 'recollection',
					sourceId: 'user',
					locator: 'this conversation',
					quote: 'I prepared a brief by hand.',
					interpretation: 'Repeat the procedure'
				}
			],
			steps: [
				{
					id: 'missing',
					kind: 'ideal',
					label: 'Create brief',
					evidenceIds: ['memory'],
					needs: 'Email',
					produces: 'Brief',
					acceptance: 'Preserve the key facts'
				}
			],
			uncertainties: []
		}
		const first = await call('studio_case_propose', { case: example })
		const inspected = await call('studio_inspect', { artifactId: first.artifactId })
		expect(inspected.artifact.payload.case.title).toBe('Remembered task')
		const changed = await call('studio_case_revise', {
			case: { ...example, title: 'Corrected task' },
			predecessorArtifactId: first.artifactId
		})
		expect(changed.payload).toMatchObject({
			status: 'proposed',
			predecessorArtifactId: first.artifactId
		})
		expect((await call('studio_case_what_if', { artifactId: changed.artifactId })).executes).toBe(
			false
		)
		expect(records.get(first.artifactId)?.payload.case.title).toBe('Remembered task')
		const refined = await call('studio_case_revise', {
			predecessorArtifactId: changed.artifactId,
			changes: { stepUpdates: [{ id: 'missing', acceptance: 'Mark uncertain facts for review.' }] }
		})
		expect(refined.payload.predecessorArtifactId).toBe(changed.artifactId)
		expect(refined.payload.status).toBe('proposed')
		expect(refined.payload.case.steps[0]).toEqual({
			...example.steps[0],
			acceptance: 'Mark uncertain facts for review.'
		})
		expect(refined.payload.case.evidence).toEqual(example.evidence)
		expect(records.get(changed.artifactId)?.payload.case.steps[0].acceptance).toBe(
			example.steps[0].acceptance
		)
		expect(bus.toolSpecs().some((s) => s.name === 'studio_case_confirm')).toBe(false)
	})
	test('an agent analyzes, creates, composes and semantically modifies a Skill', async () => {
		const { request, drafts } = draftTransport()
		const actor = new StudioActor(request)
		const bus = new MessageBus()
		bus.register(actor)

		const analyzed = JSON.parse(
			(await bus.dispatch('agent', 'studio_present', { artifactId: crypto.randomUUID() })).record
		)
		expect(analyzed).toMatchObject({ status: 'ready', title: 'Published Skill' })

		const created = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: crypto.randomUUID(),
					revision: 0,
					action: { kind: 'create', name: 'Agent-built Skill' }
				})
			).record
		)
		expect(created).toMatchObject({
			revision: 1,
			name: 'Agent-built Skill',
			steps: [],
			saved: true
		})

		const composed = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: created.id,
					revision: created.revision,
					action: { kind: 'operations', capabilityIds: [capabilityId] }
				})
			).record
		)
		expect(composed.steps[0]).toMatchObject({
			kind: 'invoke',
			capabilityId,
			inputs: { source: { kind: 'input', port: 'source' } }
		})

		const modified = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: composed.id,
					revision: composed.revision,
					action: {
						kind: 'edit',
						edits: [{ kind: 'set-step-label', stepId: 'transform', label: 'Create final result' }]
					}
				})
			).record
		)
		expect(modified.details.changes[0]).toEqual({
			path: 'steps.transform.label',
			before: 'Transform',
			after: 'Create final result'
		})
		expect(modified.steps[0].label).toBe('Create final result')
		expect(drafts.get(created.id)?.revision).toBe(3)
		const conflict = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: created.id,
					revision: 1,
					action: { kind: 'edit', edits: [{ kind: 'rename', name: 'Stale' }] }
				})
			).record
		)
		expect(conflict.ok).toBe(false)
		expect(drafts.get(created.id)?.definition.name).toBe('Agent-built Skill')
	})

	test('publishes closed semantic edit schemas and fails invalid edits without mutation', async () => {
		const { request, drafts } = draftTransport()
		const actor = new StudioActor(request)
		const editTool = actor.manifest.methods.find((method) => method.name === 'studio_author')
		if (!editTool) throw new Error('Missing edit tool')
		const actionSchema = (editTool.parameters.properties as Record<string, unknown>).action as {
			oneOf: Array<Record<string, unknown>>
		}
		expect(actionSchema.oneOf.every((variant) => variant.additionalProperties === false)).toBe(true)
		const editSchema = (
			actionSchema.oneOf.find((variant: any) => variant.properties.kind.const === 'edit') as any
		).properties.edits.items
		expect(editSchema.oneOf.every((variant: any) => variant.additionalProperties === false)).toBe(
			true
		)

		const bus = new MessageBus()
		bus.register(actor)
		const created = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: crypto.randomUUID(),
					revision: 0,
					action: { kind: 'create', name: 'Still safe' }
				})
			).record
		)
		const refused = JSON.parse(
			(
				await bus.dispatch('agent', 'studio_author', {
					id: created.id,
					revision: created.revision,
					action: {
						kind: 'edit',
						edits: [{ kind: 'rename', name: 'Unsafe', arbitraryCode: 'run()' }]
					}
				})
			).record
		)
		expect(refused).toMatchObject({ ok: false })
		expect(drafts.get(created.id)?.definition.name).toBe('Still safe')
	})
})
