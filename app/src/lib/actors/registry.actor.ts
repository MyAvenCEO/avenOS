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

	if (ev.send === 'SPAWN') {
		var spawned = cap('spawn', { template: ev.payload.template, name: ev.payload.name })
		if (!spawned) {
			return {
				state: next,
				said: 'Template ' + ev.payload.template + ' cannot be instantiated.',
				record: { ok: false, error: 'not spawnable: ' + ev.payload.template }
			}
		}
		return {
			state: next,
			said: 'Instance "' + spawned.name + '" of ' + ev.payload.template + ' is running.',
			record: { ok: true, spawned: spawned }
		}
	}

	if (ev.send === 'DISPOSE') {
		var gone = cap('dispose', { to: ev.payload.to })
		if (!gone) {
			return {
				state: next,
				said: 'Nothing disposed — unknown instance or the default one (it stays).',
				record: { ok: false, error: 'not disposable: ' + ev.payload.to }
			}
		}
		return {
			state: next,
			said: 'Instance "' + gone.name + '" is gone.',
			record: { ok: true, disposed: gone }
		}
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
	capabilities: ['actors', 'manifest', 'spawn', 'dispose'],
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
			name: 'spawn',
			description:
				'Creates a NEW instance of an actor template — "make me a second list" means ' +
				'spawn with template=workitems and a short name. The instance gets its own ' +
				'state and windows; address it via to=<name or uuid> on any tool.',
			parameters: {
				type: 'object',
				properties: {
					template: { type: 'string', description: 'The template id, e.g. "workitem".' },
					name: { type: 'string', description: 'Short display name, e.g. "Umzug".' }
				},
				required: ['template']
			},
			event: { send: 'SPAWN' }
		},
		{
			name: 'dispose',
			description:
				'Removes a spawned instance and its windows for good. The default instance ' +
				'of a template cannot be disposed. Only on explicit request.',
			parameters: {
				type: 'object',
				properties: {
					to: { type: 'string', description: 'Instance uuid or name.' }
				},
				required: ['to']
			},
			event: { send: 'DISPOSE' },
			hitl: 'Dispose this instance'
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
						uuid: a.uuid,
						template: a.manifest.id,
						id: a.manifest.id,
						name: a.instanceName,
						tags: a.manifest.tags,
						methods: a.manifest.methods.length,
						live: a.instanceState() !== null,
						default: bus.get(a.manifest.id)?.uuid === a.uuid
					})),
				manifest: (p) => bus.get(String(p.actor ?? ''))?.manifest ?? null,
				spawn: (p) => {
					const spawned = bus.spawn(String(p.template ?? ''), p.name ? String(p.name) : undefined)
					return spawned ? { uuid: spawned.uuid, name: spawned.instanceName } : null
				},
				dispose: (p) => {
					const gone = bus.dispose(String(p.to ?? ''))
					return gone ? { uuid: gone.uuid, name: gone.instanceName } : null
				}
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
