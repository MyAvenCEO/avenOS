import type { Activity, ActivityKind } from './activity.svelte'
import { Actor, type HandlerResult } from './actor'

/**
 * The work-item actor — the todo app, rebuilt as one actor.
 *
 * Everything the old skills/workitems folder spread over four files lives
 * here as a single actor: private state (the items, the active spark, the
 * view shape), handlers (the methods the model calls, as ordinary
 * messages), Prolog contracts (route produces work(M, Spark); this actor
 * consumes it and produces workitem(W)), and the words for what happened
 * (summaries for the toast and transcript). The view components read the
 * actor's state; voice and mouse are the same operations on the same data.
 */

export type WorkItemStatus = 'open' | 'doing' | 'done'

export interface Spark {
	id: string
	name: string
	color: string
}

export const SPARKS: Spark[] = [
	{ id: 'me', name: 'Me', color: '#d4a373' },
	{ id: 'team', name: 'Team', color: '#7e6ead' }
]

export interface WorkItem {
	id: string
	title: string
	status: WorkItemStatus
	spark: string
}

export const STATUS_LABEL: Record<WorkItemStatus, string> = {
	open: 'offen',
	doing: 'in Arbeit',
	done: 'erledigt'
}

const STATUS_WIRE: Record<string, WorkItemStatus> = {
	offen: 'open',
	in_arbeit: 'doing',
	erledigt: 'done'
}

/** Short and unguessable — the model copies these back from workitem_list. */
const newId = () => crypto.randomUUID().slice(0, 8)

const SPARK_PARAM = {
	type: 'string',
	enum: SPARKS.map((s) => s.id),
	description:
		'Der Projekt-Kontext (Spark): "me" für eigene Dinge, "team" für gemeinsame. ' +
		'Ohne Angabe gilt der gerade aktive Spark.'
}

const IDS_PARAM = {
	type: 'array',
	items: { type: 'string' },
	description: 'Eine oder mehrere ids, exakt so wie workitem_list sie geliefert hat.'
}

export class WorkItemsActor extends Actor {
	items = $state<WorkItem[]>([])
	/** The spark the views show and new items land in. */
	active = $state<string>('me')
	/** Which shape the workspace renders — switched by message, not button. */
	view = $state<'list' | 'board'>('list')

	constructor() {
		super(
			{
				id: 'workitems',
				name: 'Work Items',
				description:
					'Führt die Aufgabenliste: anlegen, Status ändern, löschen, anzeigen. ' +
					'Jede Aufgabe gehört zu genau einem Spark und hat einen von drei Status.',
				tags: ['todo'],
				requires: ['work(M, Spark)'],
				produces: ['workitem(W)'],
				methods: [
					{
						name: 'workitem_list',
						description:
							'Gibt alle Aufgaben mit id, Status und Spark zurück — über alle Sparks. Rufe das ' +
							'auf, bevor du über die Liste sprichst, und immer bevor du etwas änderst oder ' +
							'löschst — du brauchst die ids.',
						parameters: { type: 'object', properties: {} }
					},
					{
						name: 'workitem_create',
						description:
							'Legt eine oder mehrere neue Aufgaben an. Mehrere Aufgaben immer in einem ' +
							'einzigen Aufruf, nicht nacheinander.',
						parameters: {
							type: 'object',
							properties: {
								titles: {
									type: 'array',
									items: { type: 'string' },
									description: 'Die Titel, kurz und in der Sprache des Nutzers.'
								},
								spark: SPARK_PARAM
							},
							required: ['titles']
						},
						produces: ['workitem(W)']
					},
					{
						name: 'workitem_update',
						description:
							'Ändert eine oder mehrere Aufgaben — Status oder Titel. Alle gemeinten Aufgaben ' +
							'in einem Aufruf. „habe ich schon", „ist erledigt", „hab ich gemacht" heißen alle ' +
							'status=erledigt, nicht löschen. „Fange ich gerade an", „bin ich dran" heißen ' +
							'status=in_arbeit.',
						parameters: {
							type: 'object',
							properties: {
								ids: IDS_PARAM,
								status: {
									type: 'string',
									enum: ['offen', 'in_arbeit', 'erledigt'],
									description: 'Neuer Status der Aufgaben.'
								},
								done: {
									type: 'boolean',
									description: 'Kurzform: true = erledigt, false = offen. status geht vor.'
								},
								title: {
									type: 'string',
									description: 'Neuer Titel. Nur sinnvoll bei genau einer id.'
								},
								spark: SPARK_PARAM
							},
							required: ['ids']
						}
					},
					{
						name: 'workitem_delete',
						description:
							'Löscht eine oder mehrere Aufgaben unwiderruflich. Nur wenn jemand ausdrücklich ' +
							'löschen, entfernen oder streichen sagt. Etwas erledigt zu haben ist kein Grund — ' +
							'dafür ist workitem_update mit status=erledigt da. Im Zweifel abhaken.',
						parameters: {
							type: 'object',
							properties: { ids: IDS_PARAM },
							required: ['ids']
						}
					},
					{
						name: 'workitem_show',
						description:
							'Wechselt, was der Nutzer sieht: die Ansicht (liste oder board) und/oder den ' +
							'aktiven Spark. „Zeig mir das Board" heißt view=board; „zeig meine Liste" heißt ' +
							'spark=me. Ändert keine Daten.',
						parameters: {
							type: 'object',
							properties: {
								view: {
									type: 'string',
									enum: ['liste', 'board'],
									description: 'Die Form: liste oder board.'
								},
								spark: SPARK_PARAM
							}
						}
					},
					{
						name: 'workitem_clear_done',
						description:
							'Löscht alle bereits erledigten Aufgaben des aktiven Sparks auf einmal. Keine ids nötig.',
						parameters: { type: 'object', properties: {} }
					}
				]
			},
			{}
		)
		// Handlers close over `this`; the base class stores them by name.
		this.bind({
			workitem_list: () => this.#list(),
			workitem_create: (p) => this.#create(p),
			workitem_update: (p) => this.#update(p),
			workitem_delete: (p) => this.#delete(p),
			workitem_show: (p) => this.#show(p),
			workitem_clear_done: () => this.#clearDone()
		})
	}

	// ------------------------------------------------------------- view API

	get visible(): WorkItem[] {
		return this.items.filter((t) => t.spark === this.active)
	}

	get open(): WorkItem[] {
		return this.visible.filter((t) => t.status !== 'done')
	}

	byId(id: string): WorkItem | undefined {
		return this.items.find((t) => t.id === id)
	}

	create(title: string, spark: string = this.active): WorkItem {
		this.items.push({ id: newId(), title: title.trim(), status: 'open', spark })
		return this.items[this.items.length - 1]
	}

	update(
		id: string,
		changes: { title?: string; status?: WorkItemStatus; spark?: string }
	): WorkItem | undefined {
		const item = this.byId(id)
		if (!item) return undefined
		if (changes.title !== undefined) item.title = changes.title.trim()
		if (changes.status !== undefined) item.status = changes.status
		if (changes.spark !== undefined) item.spark = changes.spark
		return item
	}

	remove(id: string): WorkItem | undefined {
		const item = this.byId(id)
		if (!item) return undefined
		this.items = this.items.filter((t) => t.id !== id)
		return item
	}

	/** The checkbox gesture: anything not done becomes done, done reopens. */
	toggle(id: string): WorkItem | undefined {
		const item = this.byId(id)
		if (!item) return undefined
		item.status = item.status === 'done' ? 'open' : 'done'
		return item
	}

	/** The badge gesture: one step around open → doing → done → open. */
	cycle(id: string): WorkItem | undefined {
		const item = this.byId(id)
		if (!item) return undefined
		item.status = item.status === 'open' ? 'doing' : item.status === 'doing' ? 'done' : 'open'
		return item
	}

	// ------------------------------------------------------------- handlers

	#json(value: unknown): string {
		return JSON.stringify(value)
	}

	#line(t: WorkItem): string {
		return `${t.id} ${t.title} (${STATUS_LABEL[t.status]}, ${t.spark})`
	}

	#ok(record: Record<string, unknown>, wire: string): HandlerResult {
		return { record: this.#json(record), wire }
	}

	#list(): HandlerResult {
		const wire =
			this.items.length === 0
				? 'Liste: nichts'
				: `Liste (${this.items.length}): ${this.items.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: true, items: this.items }, wire)
	}

	#sparkOf(p: Record<string, unknown>): string {
		return typeof p.spark === 'string' && SPARKS.some((s) => s.id === p.spark)
			? p.spark
			: this.active
	}

	#idList(value: unknown): string[] {
		if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
		return typeof value === 'string' && value !== '' ? [value] : []
	}

	#missingIds(): HandlerResult {
		const wire = `keine gültigen ids übergeben — nimm die ids aus dieser Liste. ${this.#list().wire}`
		return {
			record: this.#json({ ok: false, error: 'keine gültigen ids übergeben', items: this.items }),
			wire
		}
	}

	#create(p: Record<string, unknown>): HandlerResult {
		const titles = (Array.isArray(p.titles) ? p.titles : [p.titles])
			.filter((t): t is string => typeof t === 'string')
			.map((t) => t.trim())
			.filter((t) => t !== '')
		if (titles.length === 0)
			return {
				record: this.#json({ ok: false, error: 'keine Titel angegeben' }),
				wire: 'keine Titel angegeben'
			}
		const spark = this.#sparkOf(p)
		const created = titles.map((t) => this.create(t, spark))
		return this.#ok(
			{ ok: true, created },
			`neu angelegt (${created.length}): ${created.map((t) => this.#line(t)).join('; ')}`
		)
	}

	#update(p: Record<string, unknown>): HandlerResult {
		const ids = this.#idList(p.ids)
		if (ids.length === 0) return this.#missingIds()

		const changes: { title?: string; status?: WorkItemStatus; spark?: string } = {}
		if (typeof p.title === 'string') changes.title = p.title
		if (typeof p.spark === 'string' && SPARKS.some((s) => s.id === p.spark)) changes.spark = p.spark
		if (typeof p.status === 'string' && p.status in STATUS_WIRE)
			changes.status = STATUS_WIRE[p.status]
		else if (typeof p.done === 'boolean') changes.status = p.done ? 'done' : 'open'

		const unknown = ids.filter((id) => !this.byId(id))
		const updated = ids.map((id) => this.update(id, changes)).filter((t) => t !== undefined)
		const wire =
			updated.length === 0
				? `nichts geändert; unbekannte ids: ${unknown.join(', ')}`
				: `geändert (${updated.length}): ${updated.map((t) => this.#line(t)).join('; ')}${
						unknown.length > 0 ? `. unbekannte ids: ${unknown.join(', ')}` : ''
					}`
		return this.#ok({ ok: updated.length > 0, updated, unbekannteIds: unknown }, wire)
	}

	#delete(p: Record<string, unknown>): HandlerResult {
		const ids = this.#idList(p.ids)
		if (ids.length === 0) return this.#missingIds()
		const targets = ids.map((id) => this.byId(id)).filter((t) => t !== undefined)
		const unknown = ids.filter((id) => !targets.some((t) => t.id === id))
		const deleted = targets.map((t) => this.remove(t.id)).filter((t) => t !== undefined)
		const wire =
			deleted.length === 0
				? `nichts gelöscht; unbekannte ids: ${unknown.join(', ')}`
				: `gelöscht (${deleted.length}): ${deleted.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: deleted.length > 0, deleted, unbekannteIds: unknown }, wire)
	}

	#show(p: Record<string, unknown>): HandlerResult {
		if (p.view === 'liste' || p.view === 'board') this.view = p.view === 'board' ? 'board' : 'list'
		if (typeof p.spark === 'string' && SPARKS.some((s) => s.id === p.spark)) this.active = p.spark
		return this.#ok(
			{ ok: true, view: this.view, spark: this.active },
			`Angezeigt wird jetzt: ${this.view === 'board' ? 'Board' : 'Liste'}, Spark ${this.active}`
		)
	}

	#clearDone(): HandlerResult {
		const removed = this.visible.filter((t) => t.status === 'done')
		this.items = this.items.filter((t) => t.spark !== this.active || t.status !== 'done')
		const wire =
			removed.length === 0
				? 'gelöscht: nichts'
				: `gelöscht (${removed.length}): ${removed.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: true, deleted: removed }, wire)
	}

	// ------------------------------------------------------------ self-talk

	protected override situation(): string {
		const bySpark = SPARKS.map(
			(s) =>
				`${s.name}: ${this.items.filter((t) => t.spark === s.id && t.status !== 'done').length} offen`
		).join(', ')
		return `${this.items.length} Aufgaben (${bySpark}); Ansicht ${this.view}, aktiver Spark ${this.active}.`
	}

	/** One displayable entry out of a raw handler record, or null for a no-op. */
	summarize(method: string, recordJson: string): Omit<Activity, 'id'> | null {
		let record: Record<string, unknown>
		try {
			record = JSON.parse(recordJson)
		} catch {
			return null
		}
		const titles = (key: string): string[] =>
			Array.isArray(record[key])
				? (record[key] as WorkItem[]).map((t) => t?.title).filter(Boolean)
				: []

		if (record.ok === false) {
			return {
				kind: 'failed',
				titles: [],
				note: typeof record.error === 'string' ? record.error : method
			}
		}

		switch (method) {
			case 'workitem_create':
				return { kind: 'created', titles: titles('created') }
			case 'workitem_update': {
				const changed = titles('updated')
				if (changed.length === 0) return null
				const first = (record.updated as WorkItem[])[0]
				const kind: ActivityKind =
					first?.status === 'done'
						? 'done'
						: first?.status === 'doing'
							? 'doing'
							: first?.status === 'open'
								? 'reopened'
								: 'renamed'
				return { kind, titles: changed }
			}
			case 'workitem_delete':
			case 'workitem_clear_done':
				return { kind: 'deleted', titles: titles('deleted') }
			case 'workitem_list':
				return {
					kind: 'read',
					titles: [],
					note: `${(record.items as unknown[])?.length ?? 0} Aufgaben gelesen`
				}
			case 'workitem_show': {
				const view = record.view === 'board' ? 'Board' : 'Liste'
				const spark = record.spark === 'team' ? 'Team' : 'Me'
				return { kind: 'switched', titles: [], note: `${view} · ${spark}` }
			}
			default:
				return null
		}
	}
}

/** The one instance — rail, views, and bus all see the same state. */
export const workItems = new WorkItemsActor()
