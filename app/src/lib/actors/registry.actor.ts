import { Actor, type Manifest, manifestProse } from './actor'
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
	 * Hooks for the UI layer: created actors get windows, deleted ones lose
	 * them. Optional so the registry stays pure in tests — the windows module
	 * wires them in the app.
	 */
	onCreated?: (actor: Actor) => void
	onRemoved?: (id: string) => void

	constructor(bus: MessageBus, store: ManifestStore | null = defaultStore()) {
		super({
			id: 'registry',
			name: 'Registry',
			description:
				'Das Verzeichnis selbst, als Actor: kennt jeden Actor im Mesh, beschreibt ihn, ' +
				'und registriert neue — per Nachricht gesprochen, dauerhaft gespeichert.',
			tags: ['system'],
			methods: [
				{
					name: 'registry_list',
					description: 'Listet alle registrierten Actors mit id, Name, Tags und Methodenzahl.',
					parameters: { type: 'object', properties: {} }
				},
				{
					name: 'registry_describe',
					description: 'Beschreibt einen Actor vollständig aus seinem Manifest.',
					parameters: {
						type: 'object',
						properties: { actor: { type: 'string', description: 'Die id des Actors.' } },
						required: ['actor']
					}
				},
				{
					name: 'actor_create',
					description:
						'Erschafft einen neuen Actor. Verträge als Prädikate wie "text(M)" — ' +
						'Großbuchstabe = Variable. Der Actor erscheint sofort im Mesh, bekommt ein ' +
						'eigenes Fenster auf dem Views-Tab und überlebt Neustarts. Noch ohne eigenen ' +
						'Code — reine Verträge (llm:true für spätere LLM-Ausführung).',
					parameters: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'Kurz, kebab-case, z.B. "kalender".' },
							name: { type: 'string', description: 'Anzeigename.' },
							description: { type: 'string', description: 'Was der Actor tut, deutsch.' },
							tags: { type: 'array', items: { type: 'string' } },
							requires: {
								type: 'array',
								items: { type: 'string' },
								description: 'Prädikate, die der Actor braucht, z.B. ["text(M)"].'
							},
							produces: {
								type: 'array',
								items: { type: 'string' },
								description: 'Prädikate, die der Actor erzeugt, z.B. ["termin(T)"].'
							},
							llm: { type: 'boolean' }
						},
						required: ['id', 'name', 'description']
					}
				},
				{
					name: 'actor_update',
					description:
						'Ändert einen zur Laufzeit erschaffenen Actor: name, description, tags, ' +
						'requires, produces oder llm. Nur übergebene Felder ändern sich. Actors aus ' +
						'Code (workitems, chat, …) sind nicht änderbar.',
					parameters: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'Die id des zu ändernden Actors.' },
							name: { type: 'string' },
							description: { type: 'string' },
							tags: { type: 'array', items: { type: 'string' } },
							requires: { type: 'array', items: { type: 'string' } },
							produces: { type: 'array', items: { type: 'string' } },
							llm: { type: 'boolean' }
						},
						required: ['id']
					}
				},
				{
					name: 'actor_delete',
					description:
						'Entfernt einen zur Laufzeit erschaffenen Actor endgültig, samt Fenster und ' +
						'Persistenz. Nur auf ausdrücklichen Wunsch.',
					parameters: {
						type: 'object',
						properties: { id: { type: 'string' } },
						required: ['id']
					}
				}
			]
		})
		this.#bus = bus
		this.#store = store
		this.bind({
			registry_list: () => this.#list(),
			registry_describe: (p) => this.#describe(p),
			actor_create: (p) => this.#create(p),
			actor_update: (p) => this.#update(p),
			actor_delete: (p) => this.#delete(p)
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
			wire: `Registriert (${rows.length}): ${rows.map((r) => r.id).join(', ')}`
		}
	}

	#describe(p: Record<string, unknown>) {
		const actor = this.#bus.get(String(p.actor ?? ''))
		if (!actor) {
			return {
				record: JSON.stringify({ ok: false, error: `kein Actor ${p.actor}` }),
				wire: `Es gibt keinen Actor ${p.actor}.`
			}
		}
		const prose = manifestProse(actor.manifest)
		return { record: JSON.stringify({ ok: true, manifest: actor.manifest }), wire: prose }
	}

	#create(p: Record<string, unknown>) {
		// Manifest fields may arrive flat (the schema) or nested under
		// `manifest` (models love wrapping) — accept both.
		const raw =
			typeof p.manifest === 'string'
				? this.#parse(p.manifest)
				: p.manifest && typeof p.manifest === 'object'
					? p.manifest
					: p
		if (!raw || typeof raw !== 'object') {
			return {
				record: JSON.stringify({ ok: false, error: 'kein lesbares Manifest' }),
				wire: 'Das Manifest war nicht lesbar.'
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
				record: JSON.stringify({ ok: false, error: 'Manifest braucht id, name, description' }),
				wire: 'Ein Manifest braucht mindestens id, name und description.'
			}
		}
		if (this.#bus.get(m.id)) {
			return {
				record: JSON.stringify({ ok: false, error: `id ${m.id} ist vergeben` }),
				wire: `Die id ${m.id} ist schon vergeben.`
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
			llm: m.llm === true
		}
		const actor = new Actor(manifest)
		this.#bus.register(actor)
		this.#persist(manifest)
		this.onCreated?.(actor)
		return {
			record: JSON.stringify({ ok: true, created: manifest }),
			wire:
				`Actor ${manifest.id} ist registriert` +
				`${manifest.requires?.length || manifest.produces?.length ? ' und hängt über seine Verträge im Mesh' : ''}.`
		}
	}

	#update(p: Record<string, unknown>) {
		const id = String(p.id ?? '')
		const existing = this.#persisted().find((m) => m.id === id)
		if (!existing) {
			return {
				record: JSON.stringify({ ok: false, error: `${id} ist nicht änderbar` }),
				wire: `${id} wurde nicht zur Laufzeit erschaffen und ist nicht änderbar.`
			}
		}
		const merged: Manifest = {
			...existing,
			name: typeof p.name === 'string' ? p.name : existing.name,
			description: typeof p.description === 'string' ? p.description : existing.description,
			tags: Array.isArray(p.tags)
				? [...p.tags.filter((t) => typeof t === 'string'), 'created']
				: existing.tags,
			requires: Array.isArray(p.requires)
				? p.requires.filter((r): r is string => typeof r === 'string')
				: existing.requires,
			produces: Array.isArray(p.produces)
				? p.produces.filter((r): r is string => typeof r === 'string')
				: existing.produces,
			llm: typeof p.llm === 'boolean' ? p.llm : existing.llm
		}
		// Replace in place: same id re-registers the fresh actor over the old.
		this.onRemoved?.(id)
		const actor = new Actor(merged)
		this.#bus.register(actor)
		this.#persist(merged)
		this.onCreated?.(actor)
		return {
			record: JSON.stringify({ ok: true, updated: merged }),
			wire: `Actor ${id} ist aktualisiert.`
		}
	}

	#delete(p: Record<string, unknown>) {
		const id = String(p.id ?? '')
		const existing = this.#persisted().find((m) => m.id === id)
		if (!existing) {
			return {
				record: JSON.stringify({ ok: false, error: `${id} ist nicht löschbar` }),
				wire: `${id} wurde nicht zur Laufzeit erschaffen und ist nicht löschbar.`
			}
		}
		this.onRemoved?.(id)
		this.#bus.unregister(id)
		if (this.#store) {
			const all = this.#persisted().filter((m) => m.id !== id)
			this.#store.setItem(STORE_KEY, JSON.stringify(all))
		}
		return {
			record: JSON.stringify({ ok: true, deleted: id }),
			wire: `Actor ${id} ist entfernt.`
		}
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
				const actor = new Actor(manifest)
				this.#bus.register(actor)
				this.onCreated?.(actor)
			}
		}
	}

	/** The UI layer calls this after setting hooks, to window the rehydrated. */
	announceExisting(): void {
		for (const manifest of this.#persisted()) {
			const actor = this.#bus.get(manifest.id)
			if (actor) this.onCreated?.(actor)
		}
	}

	protected override situation(): string {
		return `${this.#bus.actors().length} Actors im Mesh, davon ${this.#persisted().length} zur Laufzeit erschaffen.`
	}

	override instanceState(): Record<string, unknown> {
		return {
			Actors: this.#bus.actors().length,
			erschaffen: this.#persisted().length
		}
	}
}
