// board 0099 — the `data_crud` tool-actor: the ONE tool the Todos actor hub drives. Config + behavior
// co-located. The behavior IS the actor cluster: `list` = the read actor (full card), `create` = the
// create actor (new-tasks card), `update` = the edit actor (updated + before→after diff), `delete` = the
// delete actor (HITL-gated; shows which task went). The chat LLM can fire several of these in one turn,
// so create ‖ delete run in parallel, each streaming its own vibe — the hub, no edges.

import type { DataCrudArgs, ToolActor, ToolDefinition, ToolResult } from './types'

/** OpenAI-compatible tool definition the chat advertises. */
export const DATA_CRUD_TOOL: ToolDefinition = {
	type: 'function',
	function: {
		name: 'data_crud',
		description:
			'Read or modify the signed-in user\'s data for a named schema (e.g. "todos"). The current ' +
			'todos (with ids) are provided in the system context — use those ids DIRECTLY for `update` / ' +
			'`delete` (no preceding `list`). BATCH is supported and PREFERRED: create/update many in one ' +
			'call via `items`; delete many in one call via `ids`. So "delete all done", "mark A and B done", ' +
			'"add three tasks" are each a SINGLE call. Mixed intents (delete X + edit Y + add Z) = one call ' +
			'per action. Only `list` when the user asks to see the data. Values are validated server-side.',
		parameters: {
			type: 'object',
			properties: {
				schema: { type: 'string', description: 'Schema name, e.g. "todos".' },
				action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
				items: {
					type: 'array',
					description:
						'create: value objects (e.g. {"title":"Buy milk"}). update: objects including their "id" — pass MANY to edit several at once.',
					items: { type: 'object', additionalProperties: true }
				},
				id: { type: 'string', description: 'delete: a single value id to remove.' },
				ids: {
					type: 'array',
					description: 'delete: MANY value ids to remove in one call (e.g. every done todo).',
					items: { type: 'string' }
				},
				response: { type: 'string', description: 'A short human-facing reply to show the user.' }
			},
			required: ['schema', 'action']
		}
	}
}

// A `list` renders a vibe card, so tell the model to answer tersely (don't re-dump rows as Markdown). 0075.
const CARD_REPLY_NOTE =
	'Reply with ONE short sentence confirming this — the card already shows the data. Do NOT re-list ' +
	'it as prose, bullet points, or a Markdown table unless the user explicitly asks.'

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {})
const todoItem = (o: Rec) => ({
	id: o.id as string | undefined,
	title: (o.title ?? o.task) as string | undefined,
	done: o.done as boolean | undefined,
	due: o.due as string | undefined,
	priority: o.priority as string | undefined
})

/** The mode-specific vibe for a touched schema: todos → its actor card; anything else → no vibe. */
function todosVibe(
	args: DataCrudArgs,
	before: Record<string, Rec> | undefined
): { schema: string; data?: unknown } | undefined {
	if (args.schema !== 'todos') return undefined
	const items = (args.items ?? []) as Rec[]
	if (args.action === 'create') return { schema: 'todos-created', data: { items: items.map(todoItem) } }
	if (args.action === 'update') {
		const diffs = items
			.map((patch) => {
				const b = (before ?? {})[String(patch.id)] ?? {}
				const changes = Object.keys(patch)
					.filter((k) => k !== 'id' && String(patch[k] ?? '') !== String(b[k] ?? ''))
					.map((k) => ({ field: k, from: String(b[k] ?? ''), to: String(patch[k] ?? '') }))
				// the card's prominent title = the NEW state (the task IS now the updated title); a title
					// rename still shows old→new in the change rows below. board 0099.
					return { id: String(patch.id), title: String(patch.title ?? b.title ?? ''), changes }
			})
			.filter((d) => d.changes.length > 0)
		return { schema: 'todos-edited', data: { items: items.map(todoItem), diffs } }
	}
	// list (the read actor) → the full live card
	return { schema: 'todos' }
}

export const dataCrud: ToolActor = {
	definition: DATA_CRUD_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as DataCrudArgs
		const schema = typeof args.schema === 'string' ? args.schema : 'data'
		const detail = `${typeof args.action === 'string' ? args.action : ''} ${schema}`.trim() || 'data'

		// DELETE actor — HITL: never delete without explicit confirmation. Supports a BATCH (args.ids) so
		// "delete all done" is ONE confirm for many. Snapshot each todo's title so the confirm card + the
		// todos-deleted summary can name what went. The loop shows the card; nothing runs until confirmed.
		if (args.action === 'delete') {
			const ids = (
				args.ids?.length ? args.ids : args.id ? [args.id] : []
			).filter((x): x is string => typeof x === 'string' && !!x)
			let deleted: { id: string; title: string }[] = ids.map((id) => ({ id, title: '' }))
			if (schema === 'todos' && ids.length) {
				const cur = (await ctx.data({ schema: 'todos', action: 'list' })) as { items?: Rec[] }
				const byId = new Map((cur.items ?? []).map((r) => [String(r.id), String(r.title ?? '')]))
				deleted = ids.map((id) => ({ id, title: byId.get(id) ?? '' }))
			}
			const names = deleted
				.map((d) => d.title)
				.filter(Boolean)
			const label =
				schema === 'todos' && names.length
					? names.length === 1
						? `Delete todo "${names[0]}"?`
						: `Delete ${names.length} todos: ${names.join(', ')}?`
					: `Delete ${ids.length || 1} from "${schema}"?`
			return {
				detail,
				content: {
					ok: false,
					status: 'awaiting_user_confirmation',
					note: 'A confirm/decline card was shown to the user. Do NOT delete or retry — just tell them you asked them to confirm.'
				},
				hitl: {
					// carry the resolved ids + their titles so the confirm path deletes the batch + renders the card.
					label,
					action: { schema, action: 'delete', ids, _deleted: deleted }
				}
			}
		}

		// EDIT actor — snapshot the rows BEFORE the write so we can show a real before→after diff.
		let before: Record<string, Rec> | undefined
		if (schema === 'todos' && args.action === 'update') {
			const cur = (await ctx.data({ schema: 'todos', action: 'list' })) as { items?: Rec[] }
			before = Object.fromEntries((cur.items ?? []).map((r) => [String(r.id), r]))
		}

		let result: unknown
		try {
			result = await ctx.data(args)
		} catch (e) {
			result = { ok: false, error: e instanceof Error ? e.message : String(e) }
		}

		const content =
			args.action === 'list' && result && typeof result === 'object' && !Array.isArray(result)
				? { ...rec(result), note: CARD_REPLY_NOTE }
				: result

		return { detail, content, vibe: todosVibe(args, before) }
	}
}
