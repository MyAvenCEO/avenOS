import type { Activity, ActivityKind } from './activity.svelte'
import { Actor } from './actor'
import { singleton } from './singleton'
import { workitemsLogic } from './views/workitems/logic'
import { workitemsStyle } from './views/workitems/style'
import { workitemsBoardView, workitemsListView } from './views/workitems/view'

/**
 * The work-item actor — the todo app as one actor whose BEHAVIOUR lives in
 * the sandbox (0130), and whose METHODS are pure data.
 *
 * No handler in this file: every tool declares its reducer event in the
 * manifest, the Actor base binds ONE generic adapter for all of them
 * (and again under the produced functor, so the proof engine executes the
 * same reduce), and the sandbox authors both the words (`said`) and the
 * structured result (`record`). What remains here is Svelte reactivity,
 * the view API for rail and layout, and the activity summaries.
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
	/**
	 * The full view state the sandbox last produced — windows render THIS.
	 * Declared $state HERE (the base only `declare`s it) so reactivity lives
	 * in the Svelte layer and the base stays test-runnable.
	 */
	state = $state<Record<string, unknown>>({
		items: [],
		rows: [],
		columns: [],
		counts: { open: 0, doing: 0, done: 0, total: 0 },
		active: 'me',
		sparkName: 'Me',
		empty: true
	})

	constructor() {
		super({
			id: 'workitems',
			name: 'Work Items',
			description:
				'Keeps the task list: create, change status, delete, show. Every task ' +
				'belongs to exactly one spark and has one of three statuses.',
			tags: ['todo'],
			produces: ['workitem(W)'],
			logic: workitemsLogic,
			view: workitemsListView,
			style: workitemsStyle,
			views: [{ key: 'board', name: 'Kanban Board', view: workitemsBoardView }],
			methods: [
				{
					name: 'workitem_list',
					description:
						'Returns every task with id, status and spark — across all sparks. Call this ' +
						'before talking about the list, and always before changing or deleting ' +
						'anything — you need the ids.',
					parameters: { type: 'object', properties: {} },
					event: { send: 'LIST' }
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
					produces: ['workitem(W)'],
					event: { send: 'CREATE' }
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
					},
					event: { send: 'UPDATE' }
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
					},
					event: { send: 'DELETE' }
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
					},
					event: { send: 'SHOW' }
				},
				{
					name: 'workitem_clear_done',
					description:
						'Deletes every already-done task of the active spark at once. No ids needed.',
					parameters: { type: 'object', properties: {} },
					event: { send: 'CLEAR_DONE' }
				}
			]
		})
	}

	// ------------------------------------------------------------- view API

	get items(): WorkItem[] {
		return (this.state.items as WorkItem[]) ?? []
	}

	get active(): string {
		return String(this.state.active ?? 'me')
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
