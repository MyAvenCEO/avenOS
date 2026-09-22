import { describe, expect, test } from 'bun:test'
import type { StudioCatalogActor, StudioCatalogEntry } from '@avenos/actors'
import { studioActorCategory, studioCatalogTree } from '../src/lib/skills/studio-tree'

const actor = (
	id: string,
	tags: string[] = [],
	kind: StudioCatalogActor['kind'] = 'operations'
): StudioCatalogActor => ({
	actorId: id,
	label: id,
	description: '',
	version: '1',
	tags,
	placements: ['server'],
	visibleOperationCount: kind === 'event-flow' ? 0 : 1,
	kind,
	canCompose: false
})
const entry = (actorId: string, id: string, canAuthor = false): StudioCatalogEntry => ({
	actorId,
	capabilityId: id,
	version: '1',
	label: id,
	description: '',
	tags: [],
	mode: 'transform',
	parametersSchema: {},
	inputs: [],
	outputs: [],
	requires: [],
	produces: [],
	placements: ['server'],
	readiness: canAuthor ? 'needs-input' : 'contract-incomplete',
	reasonCodes: [],
	canAuthor,
	canPlan: canAuthor,
	invocationStatus: 'not-evaluated'
})

describe('Studio category navigation', () => {
	test('knowledge queries live beside calculations in Numbers & analysis', () => {
		expect(
			studioActorCategory(actor('ceo.aven:actor:knowledge@1', ['analysis', 'knowledge']))
		).toBe('numbers')
	})
	test('keeps every operation, session and unknown tool in exactly one branch', () => {
		const actors = [
			actor('invoice-extractor', ['docs']),
			actor('Listener', ['voice'], 'event-flow'),
			actor('new-package')
		]
		const entries = [
			entry('invoice-extractor', 'extract'),
			entry('new-package', 'custom'),
			entry('not-in-actor-summary', 'orphan')
		]
		const tree = studioCatalogTree(actors, entries)
		expect(
			tree
				.flatMap((group) => group.children)
				.map((branch) => branch.actor.actorId)
				.sort()
		).toEqual(['Listener', 'invoice-extractor', 'new-package', 'not-in-actor-summary'].sort())
		expect(
			tree
				.flatMap((group) =>
					group.children.flatMap((branch) => branch.entries.map((item) => item.capabilityId))
				)
				.sort()
		).toEqual(['custom', 'extract', 'orphan'])
		expect(tree.find((group) => group.id === 'finance')?.children[0]?.actor.actorId).toBe(
			'invoice-extractor'
		)
	})
	test('finds actions through category, actor and operation terms together', () => {
		const actors = [actor('invoice-extractor', ['docs']), actor('document-inspector', ['docs'])]
		const entries = [
			entry('invoice-extractor', 'extract totals'),
			entry('invoice-extractor', 'validate'),
			entry('document-inspector', 'inspect')
		]
		const tree = studioCatalogTree(actors, entries, 'finance extract totals')
		expect(tree).toHaveLength(1)
		expect(tree[0]?.children[0]?.entries.map((item) => item.capabilityId)).toEqual([
			'extract totals'
		])
		expect(studioCatalogTree(actors, entries, 'no such action')).toEqual([])
	})
	test('can-add filter includes authorable operations that still need an input', () => {
		const tree = studioCatalogTree(
			[actor('email'), actor('Listener', ['voice'], 'event-flow')],
			[entry('email', 'create brief', true), entry('email', 'send')],
			'',
			true
		)
		expect(
			tree.flatMap((group) =>
				group.children.flatMap((branch) => branch.entries.map((item) => item.capabilityId))
			)
		).toEqual(['create brief'])
	})
	test('view actors stay distinct from their subjects, regardless of a shared label', () => {
		expect(studioActorCategory(actor('Todos', ['window']))).toBe('views')
		expect(studioActorCategory(actor('Todos', ['todo']))).toBe('work')
		expect(studioActorCategory(actor('Skill Studio', ['skills', 'artifacts']))).toBe('skills')
		expect(studioActorCategory(actor('Exact calculations', ['numbers', 'analysis']))).toBe(
			'numbers'
		)
	})
})
