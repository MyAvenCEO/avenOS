import { TASK_MANIFEST } from '@avenos/productivity/actor'
import type { SkillDef } from './skill'

/**
 * Capability diagram, not a published executable Skill. The actual task
 * result contract comes from the same manifest as chat and the saved views.
 */
const result = TASK_MANIFEST.methods.find((method) => method.name === 'todo_create')!.produces!
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
					provides: result,
					live: true,
					config: { fields: ['title', 'tags', 'due', 'responsible', 'group'] }
				},
				{
					id: 'list-view',
					kind: 'output',
					name: 'List',
					about: 'Saved tasks in the selected group, with more pages available when needed.',
					type: 'view:list',
					requires: result,
					provides: ['listed'],
					live: true
				},
				{
					id: 'board-view',
					kind: 'output',
					name: 'Kanban board',
					about: 'The same saved tasks as three columns; changes check the displayed revision.',
					type: 'view:board',
					requires: result,
					provides: ['boarded'],
					live: true
				}
			]
		},
		{
			id: 'archive',
			name: 'Archive',
			about: 'Archive selected tasks on request. Restore them without losing history.',
			nodes: [
				{
					id: 'archive-trigger',
					kind: 'trigger',
					name: 'Manual',
					about: 'A request to archive explicitly selected tasks.',
					type: 'trigger:manual',
					provides: ['task_archive_request(S)'],
					live: true
				},
				{
					id: 'archive',
					kind: 'op',
					name: 'Archive selected tasks',
					about: 'Revision-checked change with a saved receipt. No tasks are deleted.',
					type: 'op:archive',
					requires: ['task_archive_request(S)'],
					provides: result,
					live: true
				}
			]
		}
	]
}
