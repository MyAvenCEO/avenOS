import type { Activity, ActivityKind } from './activity.svelte'
import { Actor, type HandlerResult, type VibeSpec } from './actor'
import { createSession, type VibeEvent, type VibeSession } from './sandbox'
import { singleton } from './singleton'
import { workitemsLogic } from './vibes/workitems/logic'
import { workitemsStyle } from './vibes/workitems/style'
import { workitemsBoardView, workitemsListView } from './vibes/workitems/view'

/**
 * The work-item actor — the todo app as one actor whose BEHAVIOUR lives in
 * the sandbox (0130).
 *
 * The CRUD logic is data (vibes/workitems/logic.ts), evaluated in a QuickJS
 * VM; this class holds the manifest, maps voice tools and UI events onto
 * the SAME reducer events, and mirrors the reduced state into a Svelte
 * $state so windows and rail re-render. Voice and mouse are byte-identical
 * by construction: both are `session.reduce(state, event)`.
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

/** The two faces over the one reducer — both declared, neither coded. */
const listVibe: VibeSpec = {
	view: workitemsListView,
	style: workitemsStyle,
	logic: workitemsLogic
}
const boardVibe: VibeSpec = {
	view: workitemsBoardView,
	style: workitemsStyle,
	logic: workitemsLogic
}

export class WorkItemsActor extends Actor {
	/** The full view state the sandbox last produced — windows render THIS. */
	vibeState = $state<Record<string, unknown>>({
		items: [],
		rows: [],
		columns: [],
		counts: { open: 0, doing: 0, done: 0, total: 0 },
		active: 'me',
		sparkName: 'Me',
		empty: true
	})
	#session: VibeSession | null = null
	#ready: Promise<void>

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
				vibe: listVibe,
				vibes: [{ key: 'board', name: 'Kanban Board', spec: boardVibe }],
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
		this.#ready = this.#boot()
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

	async #boot(): Promise<void> {
		this.#session = await createSession(workitemsLogic)
		this.vibeState = this.#session.initState({})
	}

	// ------------------------------------------------------------- view API

	/**
	 * The one door for every state change — UI events (from the vibe
	 * windows) and voice tools alike land here, so the two paths cannot
	 * drift apart.
	 */
	async applyEvent(event: VibeEvent): Promise<Record<string, unknown>> {
		await this.#ready
		if (!this.#session) throw new Error('workitems session missing')
		this.vibeState = this.#session.reduce(this.vibeState, event)
		return this.vibeState
	}

	/**
	 * The membrane seam: raw model text is parsed by the SANDBOXED shape(),
	 * never by the host. Garbage returns null and the state stays exactly
	 * what it was.
	 */
	shapeModelText(rawText: string): { state?: Record<string, unknown>; ops?: unknown[] } | null {
		if (!this.#session) return null
		const shaped = this.#session.shape(this.vibeState, rawText)
		if (shaped?.state) this.vibeState = shaped.state
		return shaped
	}

	get items(): WorkItem[] {
		return (this.vibeState.items as WorkItem[]) ?? []
	}

	get active(): string {
		return String(this.vibeState.active ?? 'me')
	}

	/** The rail's spark switch — routed through the reducer like everything. */
	set active(spark: string) {
		void this.applyEvent({ send: 'SHOW', payload: { spark } })
	}

	get visible(): WorkItem[] {
		return this.items.filter((t) => t.spark === this.active)
	}

	get open(): WorkItem[] {
		return this.visible.filter((t) => t.status !== 'done')
	}

	byId(id: string): WorkItem | undefined {
		return this.items.find((t) => t.id === id)
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

	async #create(p: Record<string, unknown>): Promise<HandlerResult> {
		const titles = (Array.isArray(p.titles) ? p.titles : [p.titles])
			.filter((t): t is string => typeof t === 'string')
			.map((t) => t.trim())
			.filter((t) => t !== '')
		if (titles.length === 0)
			return {
				record: this.#json({ ok: false, error: 'no titles given' }),
				wire: 'no titles given'
			}
		const before = new Set(this.items.map((t) => t.id))
		await this.applyEvent({
			send: 'CREATE',
			payload: { titles, ...(typeof p.spark === 'string' && { spark: p.spark }) }
		})
		const created = this.items.filter((t) => !before.has(t.id))
		return this.#ok(
			{ ok: true, created },
			`created (${created.length}): ${created.map((t) => this.#line(t)).join('; ')}`
		)
	}

	async #update(p: Record<string, unknown>): Promise<HandlerResult> {
		const ids = this.#idList(p.ids)
		if (ids.length === 0) return this.#missingIds()
		const known = new Set(this.items.map((t) => t.id))
		const unknown = ids.filter((id) => !known.has(id))
		await this.applyEvent({
			send: 'UPDATE',
			payload: {
				ids,
				...(typeof p.status === 'string' && { status: p.status }),
				...(typeof p.done === 'boolean' && { done: p.done }),
				...(typeof p.title === 'string' && { title: p.title }),
				...(typeof p.spark === 'string' && { spark: p.spark })
			}
		})
		const updated = ids.map((id) => this.byId(id)).filter((t) => t !== undefined)
		const wire =
			updated.length === 0
				? `nothing changed; unknown ids: ${unknown.join(', ')}`
				: `changed (${updated.length}): ${updated.map((t) => this.#line(t)).join('; ')}${
						unknown.length > 0 ? `. unknown ids: ${unknown.join(', ')}` : ''
					}`
		return this.#ok({ ok: updated.length > 0, updated, unknownIds: unknown }, wire)
	}

	async #delete(p: Record<string, unknown>): Promise<HandlerResult> {
		const ids = this.#idList(p.ids)
		if (ids.length === 0) return this.#missingIds()
		const targets = ids.map((id) => this.byId(id)).filter((t) => t !== undefined)
		const unknown = ids.filter((id) => !targets.some((t) => t.id === id))
		await this.applyEvent({ send: 'DELETE', payload: { ids } })
		const wire =
			targets.length === 0
				? `nothing deleted; unknown ids: ${unknown.join(', ')}`
				: `deleted (${targets.length}): ${targets.map((t) => this.#line(t)).join('; ')}`
		return this.#ok({ ok: targets.length > 0, deleted: targets, unknownIds: unknown }, wire)
	}

	async #show(p: Record<string, unknown>): Promise<HandlerResult> {
		await this.applyEvent({ send: 'SHOW', payload: { spark: String(p.spark ?? '') } })
		return this.#ok({ ok: true, spark: this.active }, `The active spark is now ${this.active}.`)
	}

	async #clearDone(): Promise<HandlerResult> {
		const removed = this.visible.filter((t) => t.status === 'done')
		await this.applyEvent({ send: 'CLEAR_DONE' })
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
