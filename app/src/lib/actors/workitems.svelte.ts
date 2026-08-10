import type { Activity, ActivityKind } from './activity.svelte'
import { Actor, type HandlerResult } from './actor'
import { singleton } from './singleton'

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
	open: 'open',
	doing: 'in progress',
	done: 'done'
}

/** Tool-boundary statuses are English like every other code-level word. */
const STATUS_WIRE: Record<string, WorkItemStatus> = {
	open: 'open',
	in_progress: 'doing',
	done: 'done'
}

/** Short and unguessable — the model copies these back from workitem_list. */
const newId = () => crypto.randomUUID().slice(0, 8)

const SPARK_PARAM = {
	type: 'string',
	enum: SPARKS.map((s) => s.id),
	description:
		'The project context (spark): "me" for personal things, "team" for shared ' +
		'ones. Without it the currently active spark applies.'
}

const IDS_PARAM = {
	type: 'array',
	items: { type: 'string' },
	description: 'One or more ids, exactly as workitem_list returned them.'
}

export class WorkItemsActor extends Actor {
	items = $state<WorkItem[]>([])
	/** The spark the views show and new items land in. */
	active = $state<string>('me')

	constructor() {
		super(
			{
				id: 'workitems',
				name: 'Work Items',
				description:
					'Keeps the task list: create, change status, delete, show. Every task ' +
					'belongs to exactly one spark and has one of three statuses.',
				tags: ['todo'],
				produces: ['workitem(W)'],
				methods: [
					{
						name: 'workitem_list',
						description:
							'Returns every task with id, status and spark — across all sparks. Call this ' +
							'before talking about the list, and always before changing or deleting ' +
							'anything — you need the ids.',
						parameters: { type: 'object', properties: {} }
					},
					{
						name: 'workitem_create',
						description:
							'Creates one or more new tasks. Multiple tasks always go in one single ' +
							'call, never one after another.',
						parameters: {
							type: 'object',
							properties: {
								titles: {
									type: 'array',
									items: { type: 'string' },
									description: 'The titles, short, in the language the user spoke.'
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
							'Changes one or more tasks — status or title. Every task meant goes in one ' +
							'call. "already did it" and "that is done" mean status=done, not delete. ' +
							'"just starting" and "working on it" mean status=in_progress.',
						parameters: {
							type: 'object',
							properties: {
								ids: IDS_PARAM,
								status: {
									type: 'string',
									enum: ['open', 'in_progress', 'done'],
									description: 'The new status of the tasks.'
								},
								done: {
									type: 'boolean',
									description: 'Shorthand: true = done, false = open. status wins.'
								},
								title: {
									type: 'string',
									description: 'The new title. Only sensible with exactly one id.'
								},
								spark: SPARK_PARAM
							},
							required: ['ids']
						}
					},
					{
						name: 'workitem_delete',
						description:
							'Deletes one or more tasks irreversibly. Only when someone explicitly asks ' +
							'to delete, remove or strike. Having finished something is no reason — that ' +
							'is workitem_update with status=done. When in doubt, check off.',
						parameters: {
							type: 'object',
							properties: { ids: IDS_PARAM },
							required: ['ids']
						}
					},
					{
						name: 'workitem_show',
						description:
							'Switches the active spark: "show my list" means spark=me, "show the team ' +
							'tasks" means spark=team. Changes no data. The SHAPE (list or board) has its ' +
							'own windows: list_window_toggle and board_window_toggle.',
						parameters: {
							type: 'object',
							properties: {
								spark: SPARK_PARAM
							},
							required: ['spark']
						}
					},
					{
						name: 'workitem_clear_done',
						description:
							'Deletes every already-done task of the active spark at once. No ids needed.',
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
				? 'list: empty'
				: `list (${this.items.length}): ${this.items.map((t) => this.#line(t)).join('; ')}`
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
		const wire = `no valid ids given — take the ids from this list. ${this.#list().wire}`
		return {
			record: this.#json({ ok: false, error: 'no valid ids given', items: this.items }),
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
				record: this.#json({ ok: false, error: 'no titles given' }),
				wire: 'no titles given'
			}
		const spark = this.#sparkOf(p)
		const created = titles.map((t) => this.create(t, spark))
		return this.#ok(
			{ ok: true, created },
			`created (${created.length}): ${created.map((t) => this.#line(t)).join('; ')}`
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
				? `nothing changed; unknown ids: ${unknown.join(', ')}`
				: `changed (${updated.length}): ${updated.map((t) => this.#line(t)).join('; ')}${
						unknown.length > 0 ? `. unknown ids: ${unknown.join(', ')}` : ''
					}`
		return this.#ok({ ok: updated.length > 0, updated, unknownIds: unknown }, wire)
	}

	#delete(p: Record<string, unknown>): HandlerResult {
		const ids = this.#idList(p.ids)
		if (ids.length === 0) return this.#missingIds()
		const targets = ids.map((id) => this.byId(id)).filter((t) => t !== undefined)
		const unknown = ids.filter((id) => !targets.some((t) => t.id === id))
		const deleted = targets.map((t) => this.remove(t.id)).filter((t) => t !== undefined)
		const wire =
			deleted.length === 0
				? `nothing deleted; unknown ids: ${unknown.join(', ')}`
				: `deleted (${deleted.length}): ${deleted.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: deleted.length > 0, deleted, unknownIds: unknown }, wire)
	}

	#show(p: Record<string, unknown>): HandlerResult {
		if (typeof p.spark === 'string' && SPARKS.some((s) => s.id === p.spark)) this.active = p.spark
		return this.#ok({ ok: true, spark: this.active }, `The active spark is now ${this.active}.`)
	}

	#clearDone(): HandlerResult {
		const removed = this.visible.filter((t) => t.status === 'done')
		this.items = this.items.filter((t) => t.spark !== this.active || t.status !== 'done')
		const wire =
			removed.length === 0
				? 'deleted: nothing'
				: `deleted (${removed.length}): ${removed.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: true, deleted: removed }, wire)
	}

	// ------------------------------------------------------------ self-talk

	override instanceState(): Record<string, unknown> {
		return {
			'tasks total': this.items.length,
			open: this.items.filter((t) => t.status === 'open').length,
			'in progress': this.items.filter((t) => t.status === 'doing').length,
			done: this.items.filter((t) => t.status === 'done').length,
			'active spark': this.active
		}
	}

	protected override situation(): string {
		const bySpark = SPARKS.map(
			(s) =>
				`${s.name}: ${this.items.filter((t) => t.spark === s.id && t.status !== 'done').length} open`
		).join(', ')
		return `${this.items.length} tasks (${bySpark}); active spark ${this.active}.`
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
					note: `${(record.items as unknown[])?.length ?? 0} tasks read`
				}
			case 'workitem_show': {
				const spark = record.spark === 'team' ? 'Team' : 'Me'
				return { kind: 'switched', titles: [], note: `Spark ${spark}` }
			}
			default:
				return null
		}
	}
}

/** The one instance — rail, views, and bus all see the same state. */
export const workItems = singleton('aven.workitems', () => new WorkItemsActor())
