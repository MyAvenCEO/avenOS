import { Actor, functor, type Manifest } from './actor'
import type { MessageBus } from './bus'

/**
 * What a created actor actually becomes: an actor with MEMORY.
 *
 * A contract-only template can be proven and executed, but a calendar that
 * cannot hold appointments is not a calendar. So every actor spoken into
 * existence is a RecordActor: it keeps a persisted list of records, and the
 * engine feeds it — each successful llm execution's output is remembered
 * (the bus calls `remember` through the RecordKeeper seam). The face's
 * `records` element renders exactly this list; running "make an appointment"
 * IS what fills the calendar.
 *
 * Two generic methods ride along on every created actor so the model can
 * read and prune the memory by voice: `<id>_records` and `<id>_forget`.
 */

export interface StoredRecord {
	id: string
	at: number
	data: unknown
}

const keyFor = (id: string) => `aven.actor-records.${id}`

export class RecordActor extends Actor {
	records = $state<StoredRecord[]>([])
	#bus: MessageBus | null

	constructor(manifest: Manifest, bus: MessageBus | null = null) {
		const methods = [...manifest.methods]
		const goal = manifest.produces?.[0]
		// The voice's obvious verb: "trag den Termin ein" needs a tool that
		// SAYS it adds entries — goal_run is the same engine but no model maps
		// a calendar wish onto it. One generic add per created actor.
		if (goal && !methods.some((m) => m.name === `${manifest.id}_add`)) {
			methods.push({
				name: `${manifest.id}_add`,
				description:
					`Adds one entry to ${manifest.name} (${manifest.id}): executes its goal ` +
					`${goal} with the given text as input and keeps the result as a record. ` +
					'Use this whenever the user wants to put something into this actor.',
				parameters: {
					type: 'object',
					properties: {
						text: {
							type: 'string',
							description: 'What to add, verbatim as the user said it.'
						}
					},
					required: ['text']
				},
				produces: [goal]
			})
		}
		if (!methods.some((m) => m.name === `${manifest.id}_records`)) {
			methods.push({
				name: `${manifest.id}_records`,
				description: `Lists the records ${manifest.name} currently keeps.`,
				parameters: { type: 'object', properties: {} }
			})
		}
		if (!methods.some((m) => m.name === `${manifest.id}_forget`)) {
			methods.push({
				name: `${manifest.id}_forget`,
				description:
					`Removes one record from ${manifest.name} by its record id ` +
					`(as ${manifest.id}_records returned it), or all of them with all=true.`,
				parameters: {
					type: 'object',
					properties: {
						record: { type: 'string', description: 'The record id to remove.' },
						all: { type: 'boolean', description: 'true = forget everything.' }
					}
				}
			})
		}
		// No declared face? Every record actor still gets one — pure
		// voice-first visualization: what to say, and what it remembered.
		const face = manifest.face ?? {
			elements: [
				{
					kind: 'note' as const,
					text: `${manifest.description} Speak to it — say what you want added.`
				},
				{ kind: 'records' as const }
			]
		}
		super({ ...manifest, methods, face })
		this.#bus = bus
		this.#load()
		this.bind({
			[`${manifest.id}_records`]: () => this.#list(),
			[`${manifest.id}_forget`]: (p) => this.#forget(p),
			...(goal && {
				[`${manifest.id}_add`]: (p: Record<string, unknown>) => this.#add(goal, p)
			})
		})
	}

	/**
	 * Execute THIS actor's goal directly — no candidate search, so "add to this
	 * calendar" can never land on some other producer of the same functor. The
	 * text grounds every declared requirement; with none declared it goes in
	 * as the payload itself. A successful execution is remembered by the
	 * engine's record seam, so the face updates by itself.
	 */
	async #add(goal: string, p: Record<string, unknown>) {
		const text = String(p.text ?? '').trim()
		if (text === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no text' }),
				wire: 'Nothing to add — the text is missing.'
			}
		}
		if (!this.#bus) {
			return {
				record: JSON.stringify({ ok: false, error: 'no bus' }),
				wire: 'This actor is not connected to an engine.'
			}
		}
		const payload =
			this.requires.length > 0
				? Object.fromEntries(this.requires.map((r) => [functor(r), { text }]))
				: { text }
		const executed = await this.#bus.execute(this, functor(goal), payload)
		return {
			record: JSON.stringify({ ok: executed.ok, added: executed.out }),
			wire: executed.ok
				? `Added to ${this.manifest.name}: ${JSON.stringify(executed.out)}`
				: `Adding failed: ${JSON.stringify(executed.out)} — actor_update with an ` +
					'instruction can rework this actor to fix it.'
		}
	}

	/** The engine's memory seam: keep what a successful execution produced. */
	remember(out: unknown): void {
		this.records.push({ id: crypto.randomUUID().slice(0, 8), at: Date.now(), data: out })
		this.#persist()
	}

	forget(recordId: string): void {
		this.records = this.records.filter((r) => r.id !== recordId)
		this.#persist()
	}

	#list() {
		const lines = this.records.map((r) => `${r.id} ${JSON.stringify(r.data)}`)
		return {
			record: JSON.stringify({ ok: true, records: this.records }),
			wire: lines.length === 0 ? 'no records yet' : `records (${lines.length}): ${lines.join('; ')}`
		}
	}

	#forget(p: Record<string, unknown>) {
		if (p.all === true) {
			const count = this.records.length
			this.records = []
			this.#persist()
			return {
				record: JSON.stringify({ ok: true, forgotten: count }),
				wire: `forgot all ${count} records`
			}
		}
		const id = String(p.record ?? '')
		const found = this.records.some((r) => r.id === id)
		if (found) this.forget(id)
		return {
			record: JSON.stringify({ ok: found, forgotten: found ? 1 : 0 }),
			wire: found ? `record ${id} forgotten` : `no record ${id}`
		}
	}

	#load(): void {
		if (typeof localStorage === 'undefined') return
		try {
			const raw = localStorage.getItem(keyFor(this.manifest.id))
			if (raw) this.records = JSON.parse(raw) as StoredRecord[]
		} catch {
			// unreadable memory starts empty rather than crashing the actor
		}
	}

	#persist(): void {
		if (typeof localStorage === 'undefined') return
		localStorage.setItem(keyFor(this.manifest.id), JSON.stringify(this.records))
	}

	override instanceState(): Record<string, unknown> {
		return {
			records: this.records.length,
			...(this.records.length > 0 && {
				latest: JSON.stringify(this.records.at(-1)?.data).slice(0, 60)
			})
		}
	}

	protected override situation(): string {
		return `${this.records.length} records kept; latest: ${
			this.records.length > 0 ? JSON.stringify(this.records.at(-1)?.data) : 'none'
		}.`
	}
}

/** Wipe a deleted actor's memory with it. */
export function clearRecords(id: string): void {
	if (typeof localStorage !== 'undefined') localStorage.removeItem(keyFor(id))
}
