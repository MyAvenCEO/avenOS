import { expect, test } from 'bun:test'
import type { ActorCallContext } from '../src/actor'
import { StudioActor } from '../src/studio/agent'
import { newStudioSkillV2 } from '../src/studio/edit'

// Host contract checks only. Real model authoring/execution is exercised by
// deploy/e2e/live-llm-skills.ts with the production Store and Runner.
test('every authoring subrequest keeps its originating host context', async () => {
	const id = crypto.randomUUID()
	const context: ActorCallContext = {
		intentId: crypto.randomUUID(),
		operationId: crypto.randomUUID(),
		contributionId: crypto.randomUUID(),
		signal: new AbortController().signal,
		canPresent: () => false
	}
	const contexts: Array<ActorCallContext | undefined> = []
	const actor = new StudioActor(
		async <T>(operation: string, data: Record<string, unknown>, current?: ActorCallContext) => {
			contexts.push(current)
			if (operation === 'state')
				return {
					drafts: [{ id, revision: 1, definition: newStudioSkillV2('Equipment register') }]
				} as T
			if (operation === 'draft') return { ...data, revision: 2 } as T
			throw Error('Unexpected request')
		}
	)
	const response = await actor.deliver(
		'studio_author',
		{
			id,
			revision: 1,
			action: { kind: 'edit', edits: [{ kind: 'rename', name: 'Tool register' }] }
		},
		context
	)
	expect(JSON.parse(response.record)).toMatchObject({
		saved: true,
		revision: 2,
		name: 'Tool register'
	})
	expect(contexts).toHaveLength(2)
	expect(contexts.every((value) => value === context)).toBe(true)
	actor.dispose()
})

test('cancellation after inspection prevents the next authoring write', async () => {
	const id = crypto.randomUUID(),
		controller = new AbortController(),
		calls: string[] = []
	const actor = new StudioActor(async <T>(operation: string) => {
		calls.push(operation)
		controller.abort()
		return {
			drafts: [{ id, revision: 1, definition: newStudioSkillV2('Equipment register') }]
		} as T
	})
	const result = await actor.deliver(
		'studio_author',
		{
			id,
			revision: 1,
			action: { kind: 'edit', edits: [{ kind: 'rename', name: 'Tool register' }] }
		},
		{ signal: controller.signal }
	)
	expect(calls).toEqual(['state'])
	expect(JSON.parse(result.record).ok).toBe(false)
	expect(result.outcome).toBeUndefined()
	actor.dispose()
})

test('invalid authoring and case commands are settled rejections before transport effects', async () => {
	const calls: string[] = [],
		id = crypto.randomUUID()
	const actor = new StudioActor(async <T>(operation: string) => {
		calls.push(operation)
		if (operation === 'state')
			return {
				drafts: [{ id, revision: 1, definition: newStudioSkillV2('Equipment register') }]
			} as T
		throw Error('Unexpected transport effect')
	})
	try {
		for (const [tool, args] of [
			['studio_author', { action: { action: { kind: 'edit', edits: [] }, id, revision: 1 } }],
			[
				'studio_author',
				{ id, revision: 1, action: { kind: 'edit', edits: [{ kind: 'nonexistent' }] } }
			],
			['studio_case_revise', { changes: {} }],
			['studio_case_propose', { case: {} }]
		] as const) {
			const result = await actor.deliver(tool, args)
			expect(JSON.parse(result.record).ok).toBe(false)
			expect(result.outcome).toBeUndefined()
		}
		expect(calls).toEqual(['state'])
	} finally {
		actor.dispose()
	}
})

test('read failures during authoring are safe, but an attempted save stays uncertain', async () => {
	const id = crypto.randomUUID()
	for (const failAt of ['state', 'draft', 'after-draft'] as const) {
		const calls: string[] = []
		const actor = new StudioActor(async <T>(operation: string) => {
			calls.push(operation)
			if (operation === failAt) throw Error('Connection lost')
			if (operation === 'state')
				return {
					drafts: [{ id, revision: 1, definition: newStudioSkillV2('Equipment register') }]
				} as T
			// An invalid acknowledgement must not turn a committed save into a safe retry.
			return {} as T
		})
		try {
			const result = await actor.deliver('studio_author', {
				id,
				revision: 1,
				action: { kind: 'edit', edits: [{ kind: 'rename', name: 'Tool register' }] }
			})
			expect(JSON.parse(result.record).ok).toBe(false)
			expect(result.outcome).toBe(failAt === 'state' ? undefined : 'uncertain')
			expect(calls).toEqual(failAt === 'state' ? ['state'] : ['state', 'draft'])
		} finally {
			actor.dispose()
		}
	}
})

test('a failed read is not an uncertain mutation, and reads never navigate', async () => {
	const presented: string[] = []
	const actor = new StudioActor(
		async () => {
			throw Error('Unavailable')
		},
		(id) => presented.push(id)
	)
	const result = await actor.deliver('studio_state', {}, { canPresent: () => true })
	expect(JSON.parse(result.record).ok).toBe(false)
	expect(result.outcome).toBeUndefined()
	expect(presented).toEqual([])
	expect(actor.manifest.methods.some((method) => method.name === 'studio_case_confirm')).toBe(false)
	actor.dispose()
})

test('case evidence identity is checked before transport, with a recoverable correction', async () => {
	const original = {
		title: 'Library returns',
		situation: 'A librarian checks returned items',
		outcome: 'A handover note',
		evidence: [
			{
				id: 'first',
				kind: 'recollection',
				sourceId: 'user',
				locator: '',
				quote: 'I check the returned items each afternoon.',
				interpretation: ''
			}
		],
		steps: [],
		uncertainties: []
	}
	const calls: string[] = [],
		predecessorArtifactId = crypto.randomUUID()
	const actor = new StudioActor(async <T>(operation: string) => {
		calls.push(operation)
		if (operation === 'inspect') return { artifact: { payload: { case: original } } } as T
		if (operation === 'case-propose') return { artifactId: crypto.randomUUID() } as T
		throw Error('Unexpected request')
	})
	try {
		const revised = structuredClone(original)
		revised.evidence[0].quote += ' I also check for missing labels.'
		const rejected = await actor.deliver('studio_case_revise', {
			predecessorArtifactId,
			case: revised
		})
		expect(JSON.parse(rejected.record)).toMatchObject({ ok: false })
		expect(rejected.record).toContain('new evidence ID')
		expect(rejected.outcome).toBeUndefined()
		expect(calls).toEqual(['inspect'])
		revised.evidence = [...original.evidence, { ...revised.evidence[0], id: 'later' }]
		const accepted = await actor.deliver('studio_case_revise', {
			predecessorArtifactId,
			case: revised
		})
		expect(JSON.parse(accepted.record).artifactId).toBeString()
		expect(calls).toEqual(['inspect', 'inspect', 'case-propose'])
		expect(original.evidence[0].quote).toBe('I check the returned items each afternoon.')
	} finally {
		actor.dispose()
	}
})

test('publication retains the editable draft handle without duplicating its immutable definition', async () => {
	const id = crypto.randomUUID(),
		artifactId = crypto.randomUUID(),
		definition = newStudioSkillV2('Equipment register')
	const artifact = { artifactId, typeKey: 'studio.skill', typeVersion: 3, payload: definition }
	const original = {
		draft: { id, revision: 4, definition, publishedArtifactId: artifactId, publishedRevision: 4 },
		artifact
	}
	const actor = new StudioActor(async <T>() => original as T)
	const receipt = JSON.parse((await actor.deliver('studio_publish', { id, revision: 4 })).record)
	expect(receipt.draft).toEqual({
		id,
		revision: 4,
		name: definition.name,
		publishedArtifactId: artifactId,
		publishedRevision: 4
	})
	expect(receipt.artifact).toEqual(artifact)
	expect(receipt.executed).toBe(false)
	expect(receipt.next).toContain('same Skill')
	expect(receipt.next).toContain('immutable successor')
	expect(original.draft.definition).toBe(definition)
	expect(actor.manifest.methods.find((m) => m.name === 'studio_author')?.description).toContain(
		'even after publication'
	)
	actor.dispose()
})
