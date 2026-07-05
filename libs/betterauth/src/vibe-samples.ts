// board 0114 — EXAMPLE SOURCE per vibe, as config (the `vibe_source` registry row seeded from here).
// Drives every "dynamic vibe" PREVIEW (DB viewer UI/State tabs, Skills actor previews) so a card never
// previews as its empty state — and kills the duplicated hardcoded sample maps that used to live in
// MainnetDb + SkillsView (partial coverage was exactly why inventory-locations previewed "0 ORTE").
// Each sample matches its vibe_logic's expected `source` keys. A completeness test enforces that every
// vibe_view row (except the special-cased `website` Composer) has one.

export const VIBE_SOURCES: Record<string, Record<string, unknown>> = {
	todos: {
		title: 'Todos',
		items: [
			{ id: '1', title: 'Buy milk', done: false, due: 'in 3 days', priority: 'high', goal: 'Eating' },
			{ id: '2', title: 'Go for a run', done: false, priority: 'medium', goal: 'Fitness' },
			{ id: '3', title: 'Old task', done: true }
		]
	},
	goals: {
		goals: [
			{ key: 'Fitness', total: 5, done: 2 },
			{ key: 'Learning', total: 3, done: 3 },
			{ key: 'Eating', total: 4, done: 0 }
		]
	},
	inventory: {
		items: [
			{ name: 'Hammer', location: 'Garage', amount: '3' },
			{ name: 'Mehl', location: 'Keller', amount: '2', scale: 'kg' },
			{ name: 'Blender', location: 'Kitchen', amount: '1' }
		]
	},
	'inventory-locations': {
		locations: [
			{ key: 'Garage', count: 6 },
			{ key: 'Kitchen', count: 3 },
			{ key: 'Keller', count: 0 }
		]
	},
	'todos-created': {
		items: [
			{ title: 'Buy milk', due: 'in 3 days', priority: 'high', goal: 'Eating', sub: '' },
			{ title: 'Pack gym bag', priority: 'medium', goal: '', sub: 'Sub-Task' }
		]
	},
	'todos-edited': {
		diffs: [{ title: 'Buy milk', changes: [{ field: 'done', from: 'false', to: 'true' }] }]
	},
	'todos-deleted': { items: [{ title: 'Old task' }] },
	ontology: {
		predicates: [
			{ name: 'owned_by', gloss: 'x1 is owned by x2' },
			{ name: 'task', gloss: 'x1 does deed x2' }
		]
	},
	'ontology-created': {
		created: [
			{
				predicate: 'eats',
				gismu: 'citka',
				gloss: 'x1 eats/ingests x2',
				places: [
					{ pos: 'x1', role: 'eater', kind: 'ref' },
					{ pos: 'x2', role: 'food', kind: 'value' }
				]
			}
		],
		reused: ['owned_by']
	},
	'query-result': {
		request: 'who owns more than 3 companies?',
		rows: [{ key: 'alice', n: 4 }],
		spec: {}
	},
	'mutation-result': {
		request: 'transfer Acme from Alice to Bob',
		ops: [
			{ op: 'delete', predicate: 'owned_by', affected: 1 },
			{ op: 'insert', predicate: 'owned_by', affected: 1 }
		]
	},
	'bundle-created': {
		request: 'track books I read with a rating',
		spec: {
			type: 'book',
			parts: [
				{ pred: 'book', kind: 'primary', field: 'title' },
				{ pred: 'rated', kind: 'replace', field: 'rating' }
			],
			project: { title: { pred: 'book', place: 'x2' }, rating: { pred: 'rated', place: 'x3' } }
		},
		mintedPredicates: ['rated']
	}
}
