import type { TypeSpec } from './types.js'

// The `todos` composite type — the board 0087 todo bundle, now fully declarative (board 0088).
// Place structures are the canonical gismu ones: task≡zukte (x1 agent, x2 action), valid≡ranji
// (x1 task, x2 from, x3 to; x3 null = open), due≡detri (x1 DATE, x2 task), prioritized≡vajni
// (x1 task, x2 user, x3 level). This object is the SEED for the predicate_type registry row; the
// betterauth engine loads the spec from the table at runtime, so there is no todos-specific code.
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
		{
			pred: 'valid',
			kind: 'singleton',
			link: 'x1',
			field: 'done',
			create: { x2: '$now', x3: '$value?$now:null' },
			set: { x3: '$value?$now:null' }
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
		done: { pred: 'valid', notNull: 'x3' },
		due: { pred: 'due', place: 'x1' },
		priority: { pred: 'prioritized', place: 'x3' }
	}
}
