import todoMachineSource from '../actors/todo-machine.pl?raw'
import type { SkillDef } from './skill'

/**
 * The todos skill — LIVE: every node here is backed by the running todo
 * actor (its sandbox reducer, its machine, its windows). Two workflows:
 * capture (intent → task → views) and sweep (clear the done). The recipe
 * interfaces are the `.pl` contract predicates.
 */
export const todosSkill: SkillDef = {
	id: 'todos',
	name: 'Todos',
	about:
		'The task list: capture intents into tasks — with tags, a due date or range, and a ' +
		'responsible person — hold them through open → doing → done, show them as list and board.',
	tags: ['todo'],
	views: [
		{ key: 'list', name: 'Todos' },
		{ key: 'board', name: 'Kanban Board' }
	],
	workflows: [
		{
			id: 'capture',
			name: 'Capture',
			about: 'An intent becomes a task and lands on the list and the board.',
			nodes: [
				{
					id: 'voice-trigger',
					kind: 'trigger',
					name: 'Voice / chat',
					about: 'A spoken or typed wish becomes a create intent.',
					type: 'trigger:voice',
					provides: ['todo_intent(I)'],
					live: true
				},
				{
					id: 'create',
					kind: 'op',
					name: 'Create task',
					about: 'The intent becomes a task: title, tags, due (date or range), responsible.',
					type: 'op:create',
					requires: ['todo_intent(I)'],
					provides: ['todo(T)'],
					machine: todoMachineSource,
					live: true,
					config: { fields: ['title', 'tags', 'due', 'responsible', 'spark'] }
				},
				{
					id: 'list-view',
					kind: 'output',
					name: 'List',
					about: 'Every task in one flat list.',
					type: 'view:list',
					requires: ['todo(T)'],
					provides: ['listed'],
					live: true
				},
				{
					id: 'board-view',
					kind: 'output',
					name: 'Kanban board',
					about: 'The three states as columns; the machine gates every move.',
					type: 'view:board',
					requires: ['todo(T)'],
					provides: ['boarded'],
					live: true
				}
			]
		},
		{
			id: 'sweep',
			name: 'Sweep',
			about: 'Clear everything done, on request.',
			nodes: [
				{
					id: 'sweep-trigger',
					kind: 'trigger',
					name: 'Manual',
					about: '"Clear done" — the button or the spoken request.',
					type: 'trigger:manual',
					provides: ['sweep_request(S)'],
					live: true
				},
				{
					id: 'clear-done',
					kind: 'op',
					name: 'Clear done',
					about: 'Every done task of the active spark leaves the list.',
					type: 'op:clear',
					requires: ['sweep_request(S)'],
					provides: ['swept'],
					live: true
				}
			]
		}
	]
}
