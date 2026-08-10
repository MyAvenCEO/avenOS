import {
	Actor,
	type FaceElement,
	type FaceSpec,
	type LlmSettings,
	type Manifest,
	manifestProse
} from './actor'
import type { MessageBus } from './bus'

/**
 * The registry as an actor — "a layer the bus can't see doesn't exist",
 * now fully true. The directory is interviewable and tool-reachable, and it
 * is where actors are spoken into existence: actor_create validates a
 * manifest, registers a contract-carrying actor at runtime, and PERSISTS
 * the manifest so the creation survives a restart. Tool list, graph,
 * stages and prover pick a created actor up instantly — growth by
 * adoption, live.
 */

const STORE_KEY = 'aven.created-actors'

/** Known face-element kinds; anything else a model invents is dropped. */
function sanitizeFace(raw: unknown): FaceSpec | undefined {
	const elements = Array.isArray(raw)
		? raw
		: raw && typeof raw === 'object' && Array.isArray((raw as FaceSpec).elements)
			? (raw as FaceSpec).elements
			: null
	if (!elements) return undefined
	const kept = elements.filter((e): e is FaceElement => {
		if (!e || typeof e !== 'object') return false
		const el = e as FaceElement
		if (el.kind === 'note') return typeof el.text === 'string'
		if (el.kind === 'state' || el.kind === 'records') return true
		if (el.kind === 'stats') return Array.isArray(el.items)
		if (el.kind === 'run') return typeof el.goal === 'string'
		if (el.kind === 'action') return typeof el.method === 'string' && typeof el.label === 'string'
		return false
	})
	return kept.length > 0 ? { elements: kept } : undefined
}

/**
 * Fold the llm field into its canonical shape: `true`, settings object, or
 * absent. Tool calls deliver model/temperature as flat llm_model /
 * llm_temperature (a schema-less object param once poisoned the whole tool
 * template); the composer delivers a real object. Both land here.
 */
function normalizeLlm(
	raw: unknown,
	model?: unknown,
	temperature?: unknown
): boolean | LlmSettings | undefined {
	const settings: LlmSettings = {}
	if (raw && typeof raw === 'object') {
		const o = raw as LlmSettings
		if (typeof o.model === 'string') settings.model = o.model
		if (typeof o.temperature === 'number') settings.temperature = o.temperature
	}
	if (typeof model === 'string' && model !== '') settings.model = model
	if (typeof temperature === 'number') settings.temperature = temperature
	if (Object.keys(settings).length > 0) return settings
	return raw === true || (raw && typeof raw === 'object') ? true : undefined
}

/** Storage seam: localStorage in the app, a Map in tests, null when absent. */
export interface ManifestStore {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
}

function defaultStore(): ManifestStore | null {
	return typeof localStorage === 'undefined' ? null : localStorage
}

export class RegistryActor extends Actor {
	#bus: MessageBus
	#store: ManifestStore | null
	/**
	 * How a created manifest becomes a live actor. The app injects a stateful
	 * kind (records, persistence); tests and the default stay with the plain
	 * Actor. Set at construction because rehydration runs in the constructor.
	 */
	#makeActor: (m: Manifest) => Actor
	/**
	 * Hooks for the UI layer: created actors get windows, deleted ones lose
	 * them. Optional so the registry stays pure in tests — the windows module
	 * wires them in the app.
	 */
	onCreated?: (actor: Actor, fresh: boolean) => void
	onRemoved?: (id: string) => void
	/** Fires only on true deletion (never on update) — memory cleanup hangs here. */
	onDeleted?: (id: string) => void
	/**
	 * The composer seam: a second, stronger model that DESIGNS manifests from
	 * freeform wishes, while the fast voice model merely relays the wish.
	 * Injected by the app (kimi-k3 via the proxy), absent in tests.
	 */
	composer?: (system: string, user: string) => Promise<string>

	constructor(
		bus: MessageBus,
		store: ManifestStore | null = defaultStore(),
		makeActor: (m: Manifest) => Actor = (m) => new Actor(m)
	) {
		super({
			id: 'registry',
			name: 'Registry',
			description:
				'The directory itself, as an actor: knows every actor in the mesh, describes ' +
				'them, and registers new ones — spoken by message, persisted for good.',
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
					name: 'actor_create',
					description:
						'Creates a new actor. Easiest: describe freely under "wish" what the actor ' +
						'should do — a stronger composer model drafts the manifest and contracts. ' +
						'Alternatively set the fields directly: contracts as predicates like ' +
						'"text(M)", uppercase = variable. The actor joins the mesh instantly, gets ' +
						'its own window, and survives restarts.',
					parameters: {
						type: 'object',
						properties: {
							wish: {
								type: 'string',
								description: 'Freeform: what the actor should do. The composer drafts the manifest.'
							},
							id: { type: 'string', description: 'Short, kebab-case, e.g. "calendar".' },
							name: { type: 'string', description: 'Display name.' },
							description: { type: 'string', description: 'What the actor does, one sentence.' },
							tags: { type: 'array', items: { type: 'string' } },
							requires: {
								type: 'array',
								items: { type: 'string' },
								description: 'Predicates the actor requires, e.g. ["text(M)"].'
							},
							produces: {
								type: 'array',
								items: { type: 'string' },
								description: 'Predicates the actor produces, e.g. ["summary(S)"].'
							},
							llm: { type: 'boolean' },
							llm_model: {
								type: 'string',
								description: 'Model id for this actor\'s own lane, e.g. "moonshotai/kimi-k3".'
							},
							llm_temperature: { type: 'number', description: 'Sampling temperature 0–2.' }
						}
					}
				},
				{
					name: 'actor_update',
					description:
						'Changes an actor created at runtime — EVERYTHING about it, including its ' +
						'window UI (the face: layout, blocks, labels, order). Easiest: describe ' +
						'freely under "instruction" what should change — the composer reworks the ' +
						'manifest, face included. Alternatively set fields directly; only the ones ' +
						'given change. Actors built from code (workitems, chat, …) cannot be changed.',
					parameters: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'The id of the actor to change.' },
							instruction: {
								type: 'string',
								description: 'Freeform: what about the actor should be different.'
							},
							name: { type: 'string' },
							description: { type: 'string' },
							tags: { type: 'array', items: { type: 'string' } },
							requires: { type: 'array', items: { type: 'string' } },
							produces: { type: 'array', items: { type: 'string' } },
							llm: { type: 'boolean' },
							llm_model: { type: 'string' },
							llm_temperature: { type: 'number' }
						},
						required: ['id']
					}
				},
				{
					name: 'actor_delete',
					description:
						'Removes a runtime-created actor for good, window and persistence included. ' +
						'Only on explicit request.',
					parameters: {
						type: 'object',
						properties: { id: { type: 'string' } },
						required: ['id']
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
		this.#store = store
		this.#makeActor = makeActor
		this.bind({
			registry_list: () => this.#list(),
			registry_describe: (p) => this.#describe(p),
			actor_create: (p) => this.#create(p),
			actor_update: (p) => this.#update(p),
			actor_delete: (p) => this.#delete(p),
			goal_run: (p) => this.#run(p)
		})
		this.#rehydrate()
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

	/**
	 * The composer prompt — the design brief a stronger model turns a wish
	 * into a manifest with. Kept here so registry semantics (what a manifest
	 * IS) and the words that teach them live side by side.
	 */
	static composerSystem(taken: string[]): string {
		return (
			'You design actor manifests for a local actor mesh. Reply with EXACTLY one ' +
			'JSON object, no markdown, no explanations: {"id": kebab-case (not taken; ' +
			`taken are: ${taken.join(', ')}), "name": display name, ` +
			'"description": one English sentence saying what the actor does, "tags": ' +
			'string[], "requires": predicates it needs, "produces": predicates it makes, ' +
			'"llm": always true — created actors execute through the model — or an ' +
			'object {"model": id, "temperature": 0..2} to pin its own lane. Predicates are ' +
			'Prolog-shaped: lowercase functor, uppercase arguments are variables, e.g. ' +
			'"request(R)" or "summary(S)". Choose contracts that connect to existing ' +
			'predicates when the wish suggests it. ' +
			'Also design "face": {"elements": [...]} — the actor\'s own window UI, ' +
			'composed from exactly these blocks: {"kind":"note","text":...} one short ' +
			'orienting line telling the user what to SAY; {"kind":"stats","items": ' +
			'[{"label":...,"aggregate":"count"|"sum"|"max"|"latest","field":...}]} ' +
			'aggregate tiles over the records; {"kind":"records","title":...,"item": ' +
			'{"title":field,"subtitle":field,"badges":[fields],"progress":numericField, ' +
			'"meta":[fields]}} the kept results as designed cards — the item mapping ' +
			'says which record field is the headline, which are pills, which draws a ' +
			'progress bar; {"kind":"state"} its live state grid. ' +
			'Design law: every face is pure VOICE-CONTROLLED RESULT VISUALIZATION. ' +
			'NO input fields, NO buttons, NO forms — ever. All functionality is reached ' +
			'by speaking; the window only shows state and results. Typical face: note, ' +
			'stats, records with an item mapping. ' +
			'CRITICAL: state in the description the EXACT flat record fields this actor ' +
			'must produce on every run (e.g. "produces records {name, status, streak, ' +
			'progress}") and make the item mapping use exactly those fields — the ' +
			'description is the execution instruction, and stable field names are what ' +
			'keep the cards consistent. ' +
			'The face is part of the manifest: when asked to change the UI or layout, ' +
			'rework the face elements exactly like any other field.'
		)
	}

	async #compose(user: string): Promise<Record<string, unknown> | null> {
		if (!this.composer) return null
		const taken = this.#bus.actors().map((a) => a.manifest.id)
		const answer = await this.composer(RegistryActor.composerSystem(taken), user)
		// Models fence JSON in ```json ... ``` no matter what you ask — unwrap.
		const bare = answer.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*?$/, '$1')
		const parsed = this.#parse(bare)
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
	}

	async #create(p: Record<string, unknown>) {
		// A freeform wish goes to the composer lane: the fast voice model
		// relays intent, the strong model does the design work.
		let composed: Record<string, unknown> | null = null
		if (typeof p.wish === 'string' && p.wish.trim() !== '') {
			if (!this.composer) {
				return {
					record: JSON.stringify({ ok: false, error: 'no composer available' }),
					wire: 'The composer is not available — set the manifest fields directly.'
				}
			}
			composed = await this.#compose(`Design a new actor. Wish: ${p.wish}`)
			if (!composed) {
				return {
					record: JSON.stringify({ ok: false, error: 'composer returned no manifest' }),
					wire: 'The composer returned no readable manifest.'
				}
			}
		}
		// Manifest fields may arrive flat (the schema) or nested under
		// `manifest` (models love wrapping) — accept both, composer first.
		const raw =
			composed ??
			(typeof p.manifest === 'string'
				? this.#parse(p.manifest)
				: p.manifest && typeof p.manifest === 'object'
					? p.manifest
					: p)
		if (!raw || typeof raw !== 'object') {
			return {
				record: JSON.stringify({ ok: false, error: 'unreadable manifest' }),
				wire: 'The manifest was not readable.'
			}
		}
		const m = raw as Partial<Manifest>
		if (
			typeof m.id !== 'string' ||
			m.id === '' ||
			typeof m.name !== 'string' ||
			typeof m.description !== 'string'
		) {
			return {
				record: JSON.stringify({ ok: false, error: 'manifest needs id, name, description' }),
				wire: 'A manifest needs at least id, name and description.'
			}
		}
		if (this.#bus.get(m.id)) {
			return {
				record: JSON.stringify({ ok: false, error: `id ${m.id} is taken` }),
				wire: `The id ${m.id} is already taken.`
			}
		}
		const tags = Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string') : []
		if (!tags.includes('created')) tags.push('created')
		const manifest: Manifest = {
			id: m.id,
			name: m.name,
			description: m.description,
			tags,
			methods: [],
			requires: Array.isArray(m.requires) ? m.requires.filter((r) => typeof r === 'string') : [],
			produces: Array.isArray(m.produces) ? m.produces.filter((r) => typeof r === 'string') : [],
			// Created actors have no code — the model IS their execution. Without
			// llm they are dead contracts ("neither a handler nor llm:true"), so
			// the default is on; a manifest may still pin a lane or (explicitly)
			// declare false-by-omission is not a thing here.
			llm: normalizeLlm(m.llm, p.llm_model, p.llm_temperature) ?? true,
			face: sanitizeFace((m as Manifest).face)
		}
		const actor = this.#makeActor(manifest)
		this.#bus.register(actor)
		this.#persist(manifest)
		this.onCreated?.(actor, true)
		return {
			record: JSON.stringify({ ok: true, created: manifest }),
			wire:
				`Actor ${manifest.id} is registered` +
				`${manifest.requires?.length || manifest.produces?.length ? ' and hangs in the mesh through its contracts' : ''}.`
		}
	}

	async #update(p: Record<string, unknown>) {
		const id = String(p.id ?? '')
		const existing = this.#persisted().find((m) => m.id === id)
		if (!existing) {
			return {
				record: JSON.stringify({ ok: false, error: `${id} is not changeable` }),
				wire: `${id} was not created at runtime and cannot be changed.`
			}
		}
		// Freeform instruction → the composer rewrites the manifest; explicit
		// fields passed alongside still win below.
		let composed: Partial<Manifest> = {}
		if (typeof p.instruction === 'string' && p.instruction.trim() !== '') {
			const drafted = await this.#compose(
				`Rework this manifest (id stays "${id}"): ${JSON.stringify(existing)}. ` +
					`Requested change: ${p.instruction}`
			)
			if (!drafted) {
				return {
					record: JSON.stringify({ ok: false, error: 'composer returned no manifest' }),
					wire: 'The composer returned no readable manifest.'
				}
			}
			composed = drafted as Partial<Manifest>
		}
		const base: Manifest = {
			...existing,
			name: typeof composed.name === 'string' ? composed.name : existing.name,
			description:
				typeof composed.description === 'string' ? composed.description : existing.description,
			tags: Array.isArray(composed.tags)
				? [...composed.tags.filter((t) => typeof t === 'string'), 'created']
				: existing.tags,
			requires: Array.isArray(composed.requires)
				? composed.requires.filter((r): r is string => typeof r === 'string')
				: existing.requires,
			produces: Array.isArray(composed.produces)
				? composed.produces.filter((r): r is string => typeof r === 'string')
				: existing.produces,
			llm: composed.llm !== undefined ? normalizeLlm(composed.llm) : existing.llm,
			face: composed.face !== undefined ? sanitizeFace(composed.face) : existing.face
		}
		const merged: Manifest = {
			...base,
			name: typeof p.name === 'string' ? p.name : base.name,
			description: typeof p.description === 'string' ? p.description : base.description,
			tags: Array.isArray(p.tags)
				? [...p.tags.filter((t) => typeof t === 'string'), 'created']
				: base.tags,
			requires: Array.isArray(p.requires)
				? p.requires.filter((r): r is string => typeof r === 'string')
				: base.requires,
			produces: Array.isArray(p.produces)
				? p.produces.filter((r): r is string => typeof r === 'string')
				: base.produces,
			llm:
				(p.llm !== undefined || p.llm_model !== undefined || p.llm_temperature !== undefined
					? normalizeLlm(p.llm, p.llm_model, p.llm_temperature)
					: base.llm) ?? true
		}
		// Replace in place: same id re-registers the fresh actor over the old.
		this.onRemoved?.(id)
		const actor = this.#makeActor(merged)
		this.#bus.register(actor)
		this.#persist(merged)
		this.onCreated?.(actor, false)
		return {
			record: JSON.stringify({ ok: true, updated: merged }),
			wire: `Actor ${id} is updated.`
		}
	}

	#delete(p: Record<string, unknown>) {
		const id = String(p.id ?? '')
		const existing = this.#persisted().find((m) => m.id === id)
		if (!existing) {
			return {
				record: JSON.stringify({ ok: false, error: `${id} is not deletable` }),
				wire: `${id} was not created at runtime and cannot be deleted.`
			}
		}
		this.onRemoved?.(id)
		this.onDeleted?.(id)
		this.#bus.unregister(id)
		if (this.#store) {
			const all = this.#persisted().filter((m) => m.id !== id)
			this.#store.setItem(STORE_KEY, JSON.stringify(all))
		}
		return {
			record: JSON.stringify({ ok: true, deleted: id }),
			wire: `Actor ${id} is removed.`
		}
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

	#parse(text: string): unknown {
		try {
			return JSON.parse(text)
		} catch {
			return null
		}
	}

	#persisted(): Manifest[] {
		if (!this.#store) return []
		try {
			const raw = this.#store.getItem(STORE_KEY)
			return raw ? (JSON.parse(raw) as Manifest[]) : []
		} catch {
			return []
		}
	}

	#persist(manifest: Manifest): void {
		if (!this.#store) return
		const all = this.#persisted().filter((m) => m.id !== manifest.id)
		all.push(manifest)
		this.#store.setItem(STORE_KEY, JSON.stringify(all))
	}

	/** Spoken into existence and it stays: re-register persisted manifests. */
	#rehydrate(): void {
		for (const manifest of this.#persisted()) {
			if (!this.#bus.get(manifest.id)) {
				// Heal legacy manifests on load: actors persisted before the
				// llm-by-default rule are dead contracts without it.
				const actor = this.#makeActor({ ...manifest, llm: manifest.llm ?? true })
				this.#bus.register(actor)
				this.onCreated?.(actor, false)
			}
		}
	}

	/** The UI layer calls this after setting hooks, to window the rehydrated. */
	announceExisting(): void {
		for (const manifest of this.#persisted()) {
			const actor = this.#bus.get(manifest.id)
			if (actor) this.onCreated?.(actor, false)
		}
	}

	protected override situation(): string {
		return `${this.#bus.actors().length} actors in the mesh, ${this.#persisted().length} of them created at runtime.`
	}

	override instanceState(): Record<string, unknown> {
		return {
			actors: this.#bus.actors().length,
			created: this.#persisted().length
		}
	}
}
