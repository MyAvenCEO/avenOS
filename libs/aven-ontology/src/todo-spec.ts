import type { TypeSpec } from './types.js'

// The `todos` composite type — the board 0087 todo bundle, fully declarative (board 0088), with the
// board 0092 canonical-fidelity corrections. Place structures are the canonical gismu ones:
//   task≡zukte (x1 agent, x2 action), owned_by≡ponse (x1 account, x2 entity — UNIVERSAL ownership),
//   done≡mulno (x1 task; the predication PRESENT = done), due≡detri (x1 DATE, x2 task),
//   prioritized≡vajni (x1 task, x2 user, x3 level). This object is the SEED for the predicate_type
//   registry row; the betterauth engine loads the spec from the table — no todos-specific code.
export const TODO_SPEC: TypeSpec = {
	type: 'todos',
	parts: [
		{
			pred: 'task',
			kind: 'primary',
			field: 'title',
			create: { x1: '$user', x2: '$value' },
			set: { x2: '$value' }
		},
		// ponse: x1=owner(account), x2=entity. One per entity, created with it (link=x2=the task). 0092.
		{
			pred: 'owned_by',
			kind: 'singleton',
			link: 'x2',
			create: { x1: '$user' }
		},
		// mulno: x1=task. Presence = done — a replace part inserts iff `done` is truthy, else deletes. 0092.
		{
			pred: 'done',
			kind: 'replace',
			link: 'x1',
			field: 'done',
			set: { x1: '$primary' }
		},
		{
			pred: 'due',
			kind: 'replace',
			link: 'x2',
			field: 'due',
			set: { x1: '$value', x2: '$primary' }
		},
		{
			pred: 'prioritized',
			kind: 'replace',
			link: 'x1',
			field: 'priority',
			set: { x1: '$primary', x2: '$user', x3: '$value' }
		}
	],
	project: {
		title: { pred: 'task', place: 'x2' },
		done: { pred: 'done', notNull: 'x1' },
		due: { pred: 'due', place: 'x1' },
		priority: { pred: 'prioritized', place: 'x3' },
		owner: { pred: 'owned_by', place: 'x1' }
	}
}
