import { Actor, manifestProse } from './actor'
import type { MessageBus } from './bus'

/**
 * The registry as an actor — "a layer the bus can't see doesn't exist",
 * now fully true. The directory is interviewable and tool-reachable: it
 * lists the mesh, describes any actor from its manifest, and runs goals
 * through the engine.
 *
 * It no longer CREATES actors. The set of actors is declared in code
 * (catalog.ts) and registered at boot — the codebase is the source of
 * truth, not a browser store.
 */

export class RegistryActor extends Actor {
	#bus: MessageBus

	constructor(bus: MessageBus) {
		super({
			id: 'registry',
			name: 'Registry',
			description:
				'The directory itself, as an actor: knows every actor in the mesh, describes ' +
				'them, and runs goals over their contracts.',
			tags: ['system'],
			methods: [
				{
					name: 'registry_list',
					description: 'Lists every registered actor with id, name, tags and method count.',
					parameters: { type: 'object', properties: {} }
				},
				{
					name: 'registry_describe',
					description: 'Describes one actor completely from its manifest.',
					parameters: {
						type: 'object',
						properties: { actor: { type: 'string', description: 'The actor id.' } },
						required: ['actor']
					}
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
					}
				}
			]
		})
		this.#bus = bus
		this.bind({
			registry_list: () => this.#list(),
			registry_describe: (p) => this.#describe(p),
			goal_run: (p) => this.#run(p)
		})
	}

	#list() {
		const rows = this.#bus.actors().map((a) => ({
			id: a.manifest.id,
			name: a.manifest.name,
			tags: a.manifest.tags,
			methods: a.manifest.methods.length,
			live: a.instanceState() !== null
		}))
		return {
			record: JSON.stringify({ ok: true, actors: rows }),
			wire: `Registered (${rows.length}): ${rows.map((r) => r.id).join(', ')}`
		}
	}

	#describe(p: Record<string, unknown>) {
		const actor = this.#bus.get(String(p.actor ?? ''))
		if (!actor) {
			return {
				record: JSON.stringify({ ok: false, error: `no actor ${p.actor}` }),
				wire: `There is no actor ${p.actor}.`
			}
		}
		const prose = manifestProse(actor.manifest)
		return { record: JSON.stringify({ ok: true, manifest: actor.manifest }), wire: prose }
	}

	async #run(p: Record<string, unknown>) {
		const goal = String(p.goal ?? '').trim()
		if (goal === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no goal' }),
				wire: 'The goal predicate is missing.'
			}
		}
		const facts = p.facts && typeof p.facts === 'object' ? (p.facts as Record<string, unknown>) : {}
		const run = await this.#bus.satisfy(goal, facts)
		const last = run.steps.at(-1)
		const wire =
			run.status === 'ok'
				? `Goal ${goal} satisfied in ${run.steps.length} steps. Result: ${JSON.stringify(last?.out ?? {})}`
				: `Goal ${goal} failed after ${run.steps.length} steps` +
					`${last ? `; last step: ${JSON.stringify(last.out)}` : ''}.`
		return { record: JSON.stringify({ ok: run.status === 'ok', run }), wire }
	}

	protected override situation(): string {
		return `${this.#bus.actors().length} actors in the mesh, all declared in code.`
	}

	override instanceState(): Record<string, unknown> {
		return { actors: this.#bus.actors().length }
	}
}
