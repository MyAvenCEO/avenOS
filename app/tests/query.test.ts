import { beforeEach, describe, expect, test } from 'bun:test'
import type { HeldMessage } from '../src/lib/actors/bus'
import {
	type Answer,
	clearSources,
	gateAnswers,
	type QueryContext,
	registerSource,
	rowsAnswer,
	runQuery,
	sourceIds
} from '../src/lib/query/answer'

/**
 * The answer model (0159): one stream, four shapes, sources registered rather
 * than switched on. These tests exist mainly to hold that last property — the
 * moment the engine knows what a "person" is, it stops being an engine.
 */

const GLOBAL: QueryContext = { intent: null }

beforeEach(() => {
	clearSources()
})

describe('the source registry', () => {
	test('every registered source is asked, in registration order', () => {
		registerSource('todos', () => [
			rowsAnswer('todos', [{ id: 't1', label: 'Milch', shape: 'check' }])
		])
		registerSource('brain', () => [
			rowsAnswer('brain', [{ id: 'b1', label: 'Versicherungen', shape: 'note' }])
		])

		const out = runQuery('milch', GLOBAL)

		expect(out.map((a) => a.kind)).toEqual(['rows', 'rows'])
		expect(out.map((a) => (a.kind === 'rows' ? a.source : ''))).toEqual(['todos', 'brain'])
		expect(sourceIds()).toEqual(['todos', 'brain'])
	})

	test('a source with nothing to say costs nothing on screen', () => {
		registerSource('todos', () => [rowsAnswer('todos', [])])
		registerSource('docs', () => [])

		expect(runQuery('nichts', GLOBAL)).toEqual([])
	})

	test('two sources knowing the same thing show it once', () => {
		const same: Answer = { kind: 'view', id: 'view:board', window: 'board', title: 'Board' }
		registerSource('todos', () => [same])
		registerSource('windows', () => [same])

		expect(runQuery('board', GLOBAL)).toHaveLength(1)
	})

	test('one broken source does not blank the surface', () => {
		registerSource('broken', () => {
			throw new Error('source exploded')
		})
		registerSource('todos', () => [
			rowsAnswer('todos', [{ id: 't1', label: 'Milch', shape: 'check' }])
		])

		const out = runQuery('milch', GLOBAL)

		expect(out).toHaveLength(1)
		expect(out[0]?.kind).toBe('rows')
	})

	test('re-registering an id replaces it rather than doubling it (HMR)', () => {
		registerSource('todos', () => [
			rowsAnswer('todos', [{ id: 'old', label: 'alt', shape: 'check' }])
		])
		registerSource('todos', () => [
			rowsAnswer('todos', [{ id: 'new', label: 'neu', shape: 'check' }])
		])

		const out = runQuery('x', GLOBAL)

		expect(out).toHaveLength(1)
		expect(out[0]?.kind === 'rows' && out[0].rows[0]?.id).toBe('new')
	})
})

describe('the engine knows nothing about what it is answering', () => {
	test('a shape the engine has never heard of passes through untouched', () => {
		// If the registry ever grows a switch over shapes, this fails: it invents
		// a kind on the spot and expects it to survive the round trip.
		registerSource('made-up', () => [
			rowsAnswer('made-up', [{ id: 'x1', label: 'ein Ding', shape: 'quantum-widget' }])
		])

		const out = runQuery('ding', GLOBAL)

		expect(out[0]?.kind === 'rows' && out[0].rows[0]?.shape).toBe('quantum-widget')
	})

	test('all four answer shapes travel the same pipe', () => {
		const held: HeldMessage = {
			id: 'h1',
			actor: 'docs',
			method: 'draft_approve',
			label: 'Antwortentwurf freigeben'
		}
		registerSource('mixed', () => [
			rowsAnswer('mixed', [{ id: 'r', label: 'Zeile', shape: 'check' }]),
			{ kind: 'view', id: 'view:board', window: 'board', title: 'Board' },
			{ kind: 'say', id: 's1', role: 'assistant', text: 'Hier ist es.' },
			...gateAnswers([held])
		])

		expect(runQuery('alles', GLOBAL).map((a) => a.kind)).toEqual(['rows', 'view', 'say', 'gate'])
	})
})

describe('context', () => {
	test('a source sees the intent in view and may narrow to it', () => {
		registerSource('todos', (_q, ctx) =>
			ctx.intent === null
				? [rowsAnswer('todos', [{ id: 'all', label: 'alle Todos', shape: 'check' }])]
				: [
						rowsAnswer('todos', [
							{ id: ctx.intent, label: `Todos zu ${ctx.intent}`, shape: 'check' }
						])
					]
		)

		const global = runQuery('todos', { intent: null })
		const scoped = runQuery('todos', { intent: 'krankenkasse' })

		expect(global[0]?.kind === 'rows' && global[0].rows[0]?.label).toBe('alle Todos')
		expect(scoped[0]?.kind === 'rows' && scoped[0].rows[0]?.label).toBe('Todos zu krankenkasse')
	})

	test('the query string reaches the source verbatim', () => {
		let seen = ''
		registerSource('spy', (q) => {
			seen = q
			return []
		})

		runQuery('  Zeig mir das Board  ', GLOBAL)

		expect(seen).toBe('  Zeig mir das Board  ')
	})
})

describe('gates', () => {
	test('a held message becomes an answer, keeping its id', () => {
		const held: HeldMessage = { id: 'h9', actor: 'mail', method: 'send', label: 'Mail senden' }

		const [answer] = gateAnswers([held])

		expect(answer?.kind).toBe('gate')
		expect(answer?.id).toBe('h9')
		expect(answer?.kind === 'gate' && answer.held.label).toBe('Mail senden')
	})

	test('no gates, no answers', () => {
		expect(gateAnswers([])).toEqual([])
	})
})
