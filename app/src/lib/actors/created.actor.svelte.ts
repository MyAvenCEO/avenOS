import { Actor, functor, type Manifest } from './actor'
import type { MessageBus } from './bus'
import { withRecordMethods } from './records'

/**
 * What a catalog manifest becomes at runtime: an actor with MEMORY.
 *
 * A contract-only template can be proven and executed, but a calendar that
 * cannot hold appointments is not a calendar. So every catalog actor is a
 * RecordActor: it keeps a list of records, and the engine feeds it — each
 * successful llm execution's output is remembered (the bus calls `remember`
 * through the RecordKeeper seam). The face's `records` element renders
 * exactly this list; running "make an appointment" IS what fills the
 * calendar.
 *
 * The DEFINITION lives in code (catalog.ts); only these records live in the
 * browser. Generic voice verbs come from withRecordMethods.
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
		const full = withRecordMethods(manifest)
		const goal = manifest.produces?.[0]
		super(full)
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
				: `Adding failed: ${JSON.stringify(executed.out)}`
		}
	}

	/** The engine's memory seam: keep what a successful execution produced. */
	remember(out: unknown): void {
		// Models love wrapping the payload once more ({"habit": {...}}) —
		// unwrap single-key envelopes so records store FLAT and render clean.
		let data = out
		while (
			data &&
			typeof data === 'object' &&
			Object.keys(data).length === 1 &&
			typeof Object.values(data)[0] === 'object' &&
			Object.values(data)[0] !== null
		) {
			data = Object.values(data)[0]
		}
		this.records.push({ id: crypto.randomUUID().slice(0, 8), at: Date.now(), data })
		this.#persist()
	}

	/** The newest record — the shape template the engine shows the model. */
	latestRecord(): unknown {
		return this.records.at(-1)?.data
	}

	/**
	 * Take over another actor's records wholesale, timestamps intact — the
	 * migration half of consolidation. Sorted afterwards so merged histories
	 * interleave chronologically instead of source by source.
	 */
	adopt(records: StoredRecord[]): void {
		const known = new Set(this.records.map((r) => r.id))
		for (const record of records) {
			this.records.push(
				known.has(record.id) ? { ...record, id: crypto.randomUUID().slice(0, 8) } : record
			)
		}
		this.records.sort((a, b) => a.at - b.at)
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
				'last entry': new Date(this.records.at(-1)?.at ?? 0).toLocaleString()
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
