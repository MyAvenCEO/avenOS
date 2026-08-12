import type { Manifest } from './actor'

/**
 * The default actors, declared in CODE — the single source of truth.
 *
 * Actors are no longer spoken into existence at runtime: what exists is what
 * stands here, reviewed like any other code and shipped with the app. A
 * manifest is a complete little app — contracts (what it needs, what it
 * makes), its own model lane, and a face: the window UI as data.
 *
 * Each entry becomes a RecordActor at boot (see chat.actor.svelte.ts): it
 * executes through the model and keeps what it produced. Only the RECORDS
 * live in the browser; the definitions live here.
 *
 * Adding one is a code change: append a manifest, and window, tool list,
 * graph and prover pick it up on the next load.
 */
export const catalog: Manifest[] = [
	{
		id: 'calendar',
		name: 'Calendar',
		description:
			'Keeps appointments. Every run produces one flat record ' +
			'{title, when, where, note} — when as a readable date/time string.',
		tags: ['default'],
		methods: [],
		requires: ['request(R)'],
		produces: ['appointment(A)'],
		llm: true,
		face: {
			elements: [
				{
					kind: 'note',
					text: 'Say what you want to remember — "dentist Tuesday at 2".'
				},
				{
					kind: 'stats',
					items: [
						{ label: 'Appointments', aggregate: 'count' },
						{ label: 'Latest', field: 'when', aggregate: 'latest' }
					]
				},
				{
					kind: 'records',
					title: 'Appointments',
					item: { title: 'title', subtitle: 'when', badges: ['where'], meta: ['note'] }
				}
			]
		}
	},
	{
		id: 'habits',
		name: 'Habits',
		description:
			'Tracks habits. Every run produces one flat record ' +
			'{name, cadence, streak, progress, note} — streak a number, progress 0..1.',
		tags: ['default'],
		methods: [],
		requires: ['request(R)'],
		produces: ['habit(H)'],
		llm: true,
		face: {
			elements: [
				{ kind: 'note', text: 'Say which habit you kept — "meditated again today".' },
				{
					kind: 'stats',
					items: [
						{ label: 'Habits', aggregate: 'count' },
						{ label: 'Best streak', field: 'streak', aggregate: 'max' }
					]
				},
				{
					kind: 'records',
					title: 'Habits',
					item: {
						title: 'name',
						subtitle: 'cadence',
						badges: ['streak'],
						progress: 'progress',
						meta: ['note']
					}
				}
			]
		},
		faces: [
			{
				key: 'streaks',
				name: 'Streaks',
				spec: {
					elements: [
						{
							kind: 'stats',
							items: [
								{ label: 'Habits', aggregate: 'count' },
								{ label: 'Best streak', field: 'streak', aggregate: 'max' },
								{ label: 'Total days', field: 'streak', aggregate: 'sum' }
							]
						},
						{ kind: 'records', title: 'By streak', item: { title: 'name', badges: ['streak'] } }
					]
				}
			}
		]
	},
	{
		id: 'notes',
		name: 'Notes',
		description:
			'Keeps notes and ideas. Every run produces one flat record ' +
			'{title, body, topic} — title a short headline, topic one word.',
		tags: ['default'],
		methods: [],
		requires: ['request(R)'],
		produces: ['note(N)'],
		llm: true,
		face: {
			elements: [
				{ kind: 'note', text: 'Say what to keep — "remember: the relay needs a rebuild".' },
				{ kind: 'stats', items: [{ label: 'Notes', aggregate: 'count' }] },
				{
					kind: 'records',
					title: 'Notes',
					item: { title: 'title', subtitle: 'body', badges: ['topic'] }
				}
			]
		}
	}
]
