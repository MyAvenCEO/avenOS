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
	onCreated?: (actor: Actor, fresh: boolean) => void
	onRemoved?: (id: string) => void
	/**
	 * The composer seam: a second, stronger model that DESIGNS manifests from
	 * freeform wishes, while the fast voice model merely relays the wish.
	 * Injected by the app (kimi-k3 via the proxy), absent in tests.
	 */
	composer?: (system: string, user: string) => Promise<string>

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
						'Erschafft einen neuen Actor. Am einfachsten: gib unter "wunsch" frei an, was ' +
						'der Actor tun soll — ein stärkeres Composer-Modell entwirft daraus das ' +
						'Manifest samt Verträgen. Alternativ die Felder direkt setzen: Verträge als ' +
						'Prädikate wie "text(M)", Großbuchstabe = Variable. Der Actor erscheint sofort ' +
						'im Mesh, bekommt ein eigenes Fenster und überlebt Neustarts.',
					parameters: {
						type: 'object',
						properties: {
							wunsch: {
								type: 'string',
								description: 'Freitext: was der Actor tun soll. Der Composer entwirft das Manifest.'
							},
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
						}
					}
				},
				{
					name: 'actor_update',
					description:
						'Ändert einen zur Laufzeit erschaffenen Actor. Am einfachsten: gib unter ' +
						'"anweisung" frei an, was sich ändern soll — der Composer überarbeitet das ' +
						'Manifest. Alternativ Felder direkt setzen; nur übergebene ändern sich. ' +
						'Actors aus Code (workitems, chat, …) sind nicht änderbar.',
					parameters: {
						type: 'object',
						properties: {
							id: { type: 'string', description: 'Die id des zu ändernden Actors.' },
							anweisung: {
								type: 'string',
								description: 'Freitext: was am Actor anders werden soll.'
							},
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
				},
				{
					name: 'goal_run',
					description:
						'Führt ein Ziel wirklich aus: beweist es über die Verträge und läuft den Plan — ' +
						'jeder Schritt eine Nachricht an seinen Produzenten, llm-Actors antworten über ' +
						'das Modell. Ziel als Prädikat wie "termin(T)". facts liefert externe Prädikate ' +
						'als JSON-Objekt, z.B. {"anfrage": {"text": "Zahnarzt Dienstag"}}.',
					parameters: {
						type: 'object',
						properties: {
							goal: { type: 'string', description: 'Das Ziel-Prädikat, z.B. "termin(T)".' },
							facts: {
								type: 'object',
								description: 'Externe Fakten: Funktor → Payload-Objekt.',
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

	/**
	 * The composer prompt — the design brief a stronger model turns a wish
	 * into a manifest with. Kept here so registry semantics (what a manifest
	 * IS) and the words that teach them live side by side.
	 */
	static composerSystem(taken: string[]): string {
		return (
			'Du entwirfst Actor-Manifeste für ein lokales Actor-Mesh. Antworte mit GENAU ' +
			'einem JSON-Objekt, ohne Markdown, ohne Erklärtext: {"id": kebab-case (nicht ' +
			`vergeben; vergeben sind: ${taken.join(', ')}), "name": Anzeigename, ` +
			'"description": ein deutscher Satz, was der Actor tut, "tags": string[], ' +
			'"requires": Prädikate die er braucht, "produces": Prädikate die er erzeugt, ' +
			'"llm": true wenn seine Arbeit Sprachverständnis braucht. Prädikate sind ' +
			'Prolog-artig: kleingeschriebener Funktor, Argumente mit Großbuchstaben sind ' +
			'Variablen, z.B. "anfrage(A)" oder "termin(T)". Wähle Verträge so, dass der ' +
			'Actor an bestehende Prädikate anschließt, wenn der Wunsch das nahelegt.'
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
		if (typeof p.wunsch === 'string' && p.wunsch.trim() !== '') {
			if (!this.composer) {
				return {
					record: JSON.stringify({ ok: false, error: 'kein Composer verfügbar' }),
					wire: 'Der Composer ist nicht verfügbar — bitte die Manifest-Felder direkt angeben.'
				}
			}
			composed = await this.#compose(`Entwirf einen neuen Actor. Wunsch: ${p.wunsch}`)
			if (!composed) {
				return {
					record: JSON.stringify({ ok: false, error: 'Composer lieferte kein Manifest' }),
					wire: 'Der Composer hat kein lesbares Manifest geliefert.'
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
		this.onCreated?.(actor, true)
		return {
			record: JSON.stringify({ ok: true, created: manifest }),
			wire:
				`Actor ${manifest.id} ist registriert` +
				`${manifest.requires?.length || manifest.produces?.length ? ' und hängt über seine Verträge im Mesh' : ''}.`
		}
	}

	async #update(p: Record<string, unknown>) {
		const id = String(p.id ?? '')
		const existing = this.#persisted().find((m) => m.id === id)
		if (!existing) {
			return {
				record: JSON.stringify({ ok: false, error: `${id} ist nicht änderbar` }),
				wire: `${id} wurde nicht zur Laufzeit erschaffen und ist nicht änderbar.`
			}
		}
		// Freeform instruction → the composer rewrites the manifest; explicit
		// fields passed alongside still win below.
		let composed: Partial<Manifest> = {}
		if (typeof p.anweisung === 'string' && p.anweisung.trim() !== '') {
			const drafted = await this.#compose(
				`Überarbeite dieses Manifest (id bleibt "${id}"): ${JSON.stringify(existing)}. ` +
					`Änderungswunsch: ${p.anweisung}`
			)
			if (!drafted) {
				return {
					record: JSON.stringify({ ok: false, error: 'Composer lieferte kein Manifest' }),
					wire: 'Der Composer hat kein lesbares Manifest geliefert.'
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
			llm: typeof composed.llm === 'boolean' ? composed.llm : existing.llm
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
			llm: typeof p.llm === 'boolean' ? p.llm : base.llm
		}
		// Replace in place: same id re-registers the fresh actor over the old.
		this.onRemoved?.(id)
		const actor = new Actor(merged)
		this.#bus.register(actor)
		this.#persist(merged)
		this.onCreated?.(actor, false)
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

	async #run(p: Record<string, unknown>) {
		const goal = String(p.goal ?? '').trim()
		if (goal === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'kein Ziel' }),
				wire: 'Es fehlt das Ziel-Prädikat.'
			}
		}
		const facts = p.facts && typeof p.facts === 'object' ? (p.facts as Record<string, unknown>) : {}
		const run = await this.#bus.satisfy(goal, facts)
		const last = run.steps.at(-1)
		const wire =
			run.status === 'ok'
				? `Ziel ${goal} erfüllt in ${run.steps.length} Schritten. Ergebnis: ${JSON.stringify(last?.out ?? {})}`
				: `Ziel ${goal} gescheitert nach ${run.steps.length} Schritten` +
					`${last ? `; letzter Schritt: ${JSON.stringify(last.out)}` : ''}.`
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
				const actor = new Actor(manifest)
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
		return `${this.#bus.actors().length} Actors im Mesh, davon ${this.#persisted().length} zur Laufzeit erschaffen.`
	}

	override instanceState(): Record<string, unknown> {
		return {
			Actors: this.#bus.actors().length,
			erschaffen: this.#persisted().length
		}
	}
}
