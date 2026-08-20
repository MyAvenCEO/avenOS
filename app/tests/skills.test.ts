import { describe, expect, test } from 'bun:test'
import inboxMachineSource from '../src/lib/actors/inbox-machine.pl?raw'
import { contractsOf, parseProgram } from '../src/lib/actors/machine'
import { unifiable } from '../src/lib/actors/term'
import todoMachineSource from '../src/lib/actors/todo-machine.pl?raw'
import { layoutWorkflow, workflowDoors } from '../src/lib/skills/flow-layout'
import { inboxSkill } from '../src/lib/skills/inbox.skill'
import { skills } from '../src/lib/skills/registry'
import { crossSkillEdges, skillInterface, workflowEdges } from '../src/lib/skills/skill'
import { todosSkill } from '../src/lib/skills/todos.skill'

/**
 * The skills platform (0153): skill = collection of composable workflows,
 * workflow = trigger→nodes→outputs, node = the leaf actor. Wiring is
 * derived (provides ∩ requires), boundaries by the merge law, cross-skill
 * recipe edges unify from `.pl` contracts — nothing is stored.
 */

describe('workflow wiring is derived, never stored', () => {
	test('inbox intake: triggers → normalize → classify → route', () => {
		const intake = inboxSkill.workflows[0]
		const edges = workflowEdges(intake)
		expect(edges).toContainEqual({ from: 'mail-trigger', to: 'normalize', predicate: 'mail(M)' })
		expect(edges).toContainEqual({
			from: 'upload-trigger',
			to: 'normalize',
			predicate: 'upload(U)'
		})
		expect(edges).toContainEqual({ from: 'normalize', to: 'classify', predicate: 'intake(I)' })
		expect(edges).toContainEqual({
			from: 'classify',
			to: 'route',
			predicate: 'intent(I, Class)'
		})
	})

	test('todos capture: voice trigger → create → both views', () => {
		const capture = todosSkill.workflows[0]
		const edges = workflowEdges(capture)
		expect(edges).toContainEqual({
			from: 'voice-trigger',
			to: 'create',
			predicate: 'todo_intent(I)'
		})
		expect(edges).toContainEqual({ from: 'create', to: 'list-view', predicate: 'todo(T)' })
		expect(edges).toContainEqual({ from: 'create', to: 'board-view', predicate: 'todo(T)' })
	})

	test('layout places triggers first, columns by depth', () => {
		const laid = layoutWorkflow(inboxSkill.workflows[0])
		const x = (id: string) => laid.nodes.find((n) => n.id === id)?.position.x ?? -1
		expect(x('mail-trigger')).toBe(0)
		expect(x('upload-trigger')).toBe(0)
		expect(x('normalize')).toBeGreaterThan(x('mail-trigger'))
		expect(x('classify')).toBeGreaterThan(x('normalize'))
		expect(x('route')).toBeGreaterThan(x('classify'))
	})
})

describe('skills compose: recipe edges across boundaries', () => {
	test('the inbox feeds the todos skill (todo_intent) — derived, not wired', () => {
		const cross = crossSkillEdges(skills)
		expect(cross).toContainEqual(
			expect.objectContaining({ from: 'inbox', to: 'todos', predicate: 'todo_intent(I)' })
		)
	})

	test('the inbox→todos edge unifies from the .pl contracts ALONE', () => {
		const inbox = contractsOf(parseProgram(inboxMachineSource))
		const todos = contractsOf(parseProgram(todoMachineSource))
		expect(inbox.produces.some((p) => todos.requires.some((r) => unifiable(p, r)))).toBe(true)
	})

	test('the doors: the intake workflow opens into the todos skill', () => {
		const doors = workflowDoors(inboxSkill.workflows[0], [todosSkill])
		expect(doors.map((d) => d.skill.id)).toContain('todos')
	})

	test('a skill boundary is the merge law: internals hidden', () => {
		const boundary = skillInterface(inboxSkill)
		// Everything internally bound disappears from the skin: intake(I) and
		// intent(I, Class) between nodes — and mail(M)/upload(U) too, because
		// the skill carries its own triggers. What remains is what it OFFERS.
		expect(boundary.requires).not.toContain('intake(I)')
		expect(boundary.requires).not.toContain('mail(M)')
		expect(boundary.produces).toContain('todo_intent(I)')
	})
})
