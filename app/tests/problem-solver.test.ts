import { describe, expect, test } from 'bun:test'
import { type Capability, solve } from '../src/lib/skills/problem-solver'

const inboxToTodo: Capability[] = [
	{
		id: 'inbox.normalize-mail',
		actor: 'inbox@desktop',
		method: 'normalize_mail',
		requires: ['mail(M)'],
		produces: ['intake(M)']
	},
	{
		id: 'inbox.normalize-upload',
		actor: 'inbox@desktop',
		method: 'normalize_upload',
		requires: ['upload(U)'],
		produces: ['intake(U)']
	},
	{
		id: 'inbox.classify',
		actor: 'classifier@server',
		method: 'classify',
		requires: ['intake(I)'],
		produces: ['intent(I, todo)'],
		cost: 2
	},
	{
		id: 'inbox.route-todo',
		actor: 'inbox@desktop',
		method: 'route_todo',
		requires: ['intent(I, todo)'],
		produces: ['todo_intent(I)']
	},
	{
		id: 'todos.create',
		actor: 'todos@server',
		method: 'todo_create',
		requires: ['todo_intent(I)'],
		produces: ['todo(I)']
	}
]

describe('ad-hoc capability planner', () => {
	test('compiles registry capabilities into a concrete envelope program', () => {
		const result = solve(
			inboxToTodo,
			[{ predicate: 'mail(message_42)', artifactId: 'artifact-mail-42' }],
			['todo(message_42)']
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.program.steps.map((step) => step.method)).toEqual([
			'normalize_mail',
			'classify',
			'route_todo',
			'todo_create'
		])
		expect(result.program.steps[0]?.inputs[0]?.source).toEqual({
			kind: 'ingredient',
			artifactId: 'artifact-mail-42'
		})
		expect(result.program.results[0]?.predicate).toBe('todo(message_42)')
		expect(result.program.totalCost).toBe(5)
	})

	test('treats alternative producers as OR and picks the cheaper physical plan', () => {
		const result = solve(
			[
				{
					id: 'ocr.remote',
					actor: 'ocr@server',
					method: 'extract_text',
					requires: ['file(F)'],
					produces: ['text(F)'],
					cost: 8
				},
				{
					id: 'ocr.local',
					actor: 'ocr@device',
					method: 'extract_text',
					requires: ['file(F)'],
					produces: ['text(F)'],
					cost: 2
				}
			],
			[{ predicate: 'file(scan_7)' }],
			['text(scan_7)']
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.program.steps.map((step) => step.capability)).toEqual(['ocr.local'])
	})

	test("treats a capability's inputs as AND with consistent variable bindings", () => {
		const result = solve(
			[
				{
					id: 'reconcile',
					actor: 'finance@server',
					method: 'reconcile',
					requires: ['invoice(I)', 'payment(I)'],
					produces: ['reconciled(I)']
				}
			],
			[
				{ predicate: 'invoice(inv_1)' },
				{ predicate: 'payment(inv_2)' },
				{ predicate: 'payment(inv_1)' }
			],
			['reconciled(inv_1)']
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.program.steps[0]?.inputs.map((input) => input.predicate)).toEqual([
			'invoice(inv_1)',
			'payment(inv_1)'
		])
	})

	test('reports a goal for which the registry has no complete proof', () => {
		const result = solve(inboxToTodo, [{ predicate: 'upload(scan_7)' }], ['archived(scan_7)'])

		expect(result).toMatchObject({
			ok: false,
			unmetGoals: ['archived(scan_7)']
		})
	})
})
