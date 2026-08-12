import { Actor, type Manifest } from './actor'
import type { MessageBus } from './bus'

/**
 * The registry as an actor — no caste, no special path (0130): its
 * behaviour (list, describe, run a goal) is sandboxed logic in its own
 * manifest; the host appears only as three granted capabilities,
 * fail-closed:
 *
 * - `actors`   → a snapshot of the mesh (rows, no references)
 * - `manifest` → one actor's manifest by id, or null
 * - `satisfy`  → the engine: prove + execute a goal (async; the asyncified
 *   VM suspends while the engine runs)
 *
 * It no longer CREATES actors. The set of actors is declared in code — the
 * codebase is the source of truth, not a browser store.
 */

const REGISTRY_LOGIC = `
function initState(source) {
	return { queries: 0 }
}

function prose(m) {
	var parts = 'I am ' + m.name + ' (' + m.id + '). ' + m.description
	var methods = m.methods || []
	if (methods.length > 0) {
		var names = []
		for (var i = 0; i < methods.length; i++) names.push(methods[i].name + ' — ' + methods[i].description)
		parts += ' Methods: ' + names.join(' · ')
	}
	return parts
}

function reduce(state, ev) {
	var next = { queries: state.queries + 1 }

	if (ev.send === 'LIST') {
		var rows = cap('actors')
		var ids = []
		for (var i = 0; i < rows.length; i++) ids.push(rows[i].id)
		return {
			state: next,
			said: 'Registered (' + rows.length + '): ' + ids.join(', '),
			record: { ok: true, actors: rows }
		}
	}

	if (ev.send === 'DESCRIBE') {
		var m = cap('manifest', { actor: ev.payload.actor })
		if (!m) {
			return {
				state: next,
				said: 'There is no actor ' + ev.payload.actor + '.',
				record: { ok: false, error: 'no actor ' + ev.payload.actor }
			}
		}
		return { state: next, said: prose(m), record: { ok: true, manifest: m } }
	}

	if (ev.send === 'RUN') {
		var goal = String(ev.payload.goal || '').trim()
		if (goal === '') {
			return {
				state: next,
				said: 'The goal predicate is missing.',
				record: { ok: false, error: 'no goal' }
			}
		}
		var run = cap('satisfy', { goal: goal, facts: ev.payload.facts || {} })
		var last = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null
		var said =
			run.status === 'ok'
				? 'Goal ' + goal + ' satisfied in ' + run.steps.length + ' steps. Result: ' +
					JSON.stringify((last && last.out) || {})
				: 'Goal ' + goal + ' failed after ' + run.steps.length + ' steps' +
					(last ? '; last step: ' + JSON.stringify(last.out) : '') + '.'
		return { state: next, said: said, record: { ok: run.status === 'ok', run: run } }
	}

	return state
}

function shape(state, rawText) {
	return null
}
`

const REGISTRY_MANIFEST: Manifest = {
	id: 'registry',
	name: 'Registry',
	description:
		'The directory itself, as an actor: knows every actor in the mesh, describes ' +
		'them, and runs goals over their contracts.',
	tags: ['system'],
	capabilities: ['actors', 'manifest', 'satisfy'],
	logic: REGISTRY_LOGIC,
	methods: [
		{
			name: 'registry_list',
			description: 'Lists every registered actor with id, name, tags and method count.',
			parameters: { type: 'object', properties: {} },
			event: { send: 'LIST' }
		},
		{
			name: 'registry_describe',
			description: 'Describes one actor completely from its manifest.',
			parameters: {
				type: 'object',
				properties: { actor: { type: 'string', description: 'The actor id.' } },
				required: ['actor']
			},
			event: { send: 'DESCRIBE' }
		},
		{
			name: 'goal_run',
			description:
				'Actually executes a goal: proves it over the contracts and runs the plan — ' +
				'each step one message to its producer, llm actors answering through the ' +
				'model. Goal as a predicate like "summary(S)". facts supplies external ' +
				'predicates as a JSON object, e.g. {"text": {"text": "dentist Tuesday"}}.',
			parameters: {
				type: 'object',
				properties: {
					goal: { type: 'string', description: 'The goal predicate, e.g. "summary(S)".' },
					facts: {
						type: 'object',
						description: 'External facts: functor → payload object.',
						additionalProperties: true
					}
				},
				required: ['goal']
			},
			event: { send: 'RUN' }
		}
	]
}

export class RegistryActor extends Actor {
	#bus: MessageBus

	constructor(bus: MessageBus) {
		super(
			REGISTRY_MANIFEST,
			{},
			{
				actors: () =>
					bus.actors().map((a) => ({
						id: a.manifest.id,
						name: a.manifest.name,
						tags: a.manifest.tags,
						methods: a.manifest.methods.length,
						live: a.instanceState() !== null
					})),
				manifest: (p) => bus.get(String(p.actor ?? ''))?.manifest ?? null,
				satisfy: async (p) =>
					await bus.satisfy(
						String(p.goal ?? ''),
						(p.facts as Record<string, unknown> | undefined) ?? {}
					)
			}
		)
		this.#bus = bus
	}

	protected override situation(): string {
		return `${this.#bus.actors().length} actors in the mesh, all declared in code.`
	}

	override instanceState(): Record<string, unknown> {
		return { actors: this.#bus.actors().length }
	}
}
