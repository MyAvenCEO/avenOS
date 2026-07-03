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
				filter: {
					type: 'object',
					description:
						'list only: narrow by ONE projected field — {"field":<priority|due|done|title|goal|parent>,"value":…,' +
						'"op"?:eq|neq|gt|gte|lt|lte|isnull|notnull}. medium: {"field":"priority","value":"medium"}; open: ' +
						'{"field":"done","value":false}; goal: {"field":"goal","value":"Fitness"}; top-level: ' +
						'{"field":"parent","op":"isnull"}.',
					properties: {
						field: { type: 'string' },
						value: {},
						op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isnull', 'notnull'] }
					}
				},
				items: {
					type: 'array',
					description:
						'create: value objects — todos fields: title, done, due (ISO date), priority, goal (a GROUP NAME ' +
						'label, e.g. "Fitness"), parent (a SUB-TASK: the id of the parent task from CURRENT TODOS — an id, ' +
						'NEVER a title; use goal for named groups instead). update: same fields plus the item\'s "id" — ' +
						'pass MANY to edit several at once.',
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

// A terse, deterministic reply for a successful action when the model didn't write its own `response`.
// The vibe card already shows the data, so this exists only to let the loop finish in ONE round (no
// second gemma pass just to narrate what the card already displays). board 0106.
function defaultReply(
	action: string,
	schema: string,
	items: unknown,
	result: unknown
): string {
	const listN = (result as { items?: unknown[] })?.items
	const inN = items as unknown[] | undefined
	switch (action) {
		case 'list':
			return Array.isArray(listN) ? `Showing your ${schema} (${listN.length}).` : `Showing your ${schema}.`
		case 'create':
			return Array.isArray(inN) && inN.length ? `Added ${inN.length} to ${schema}.` : `Added to ${schema}.`
		case 'update':
			return Array.isArray(inN) && inN.length > 1 ? `Updated ${inN.length} ${schema}.` : `Updated ${schema}.`
		default:
			return 'Done.'
	}
}
// A friendly relative due for the summary cards. A DATE-ONLY due is a whole-DAY deadline → compare by
// calendar day (so "today" reads "today", never "13 hours overdue"). A due WITH a time keeps day precision
// too here (the summary card is a moment-in-time snapshot). board 0105.
function relDue(iso: unknown): string | undefined {
	if (typeof iso !== 'string' || !iso.trim()) return undefined
	const s = iso.trim()
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
	if (!m) return s
	const dueDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
	if (Number.isNaN(dueDay.getTime())) return s
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const days = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000)
	if (days === 0) return 'today'
	if (days === 1) return 'tomorrow'
	if (days === -1) return 'yesterday'
	return days < 0 ? `${-days} days overdue` : `in ${days} days`
}
const todoItem = (o: Rec) => ({
	id: o.id as string | undefined,
	title: (o.title ?? o.task) as string | undefined,
	done: o.done as boolean | undefined,
	due: relDue(o.due),
	priority: o.priority as string | undefined,
	// board 0112 — the created/edited cards show the FULL badges: the goal label + a sub-task marker.
	goal: (o.goal ?? '') as string,
	sub: o.parent ? 'Sub-Task' : ''
})

/**
 * The result vibe for a touched schema. todos keeps its purpose-built actor cards (live list /
 * created / edited). Every OTHER schema is GENERIC (board 0113): a `list` renders the schema's own
 * vibe rows through the VibeCard host with the result items as its source — so a config-minted skill
 * (e.g. inventory) gets a live card with ZERO code here. No rows seeded → VibeCard shows a soft error.
 */
function resultVibe(
	args: DataCrudArgs,
	before: Record<string, Rec> | undefined,
	result: unknown
): { schema: string; data?: unknown } | undefined {
	if (args.schema !== 'todos') {
		if (args.action !== 'list') return undefined
		const items = (result as { items?: unknown[] } | null)?.items ?? []
		return { schema: args.schema, data: { items } }
	}
	const items = (args.items ?? []) as Rec[]
	if (args.action === 'create')
		return { schema: 'todos-created', data: { items: items.map(todoItem) } }
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
	// list (the read actor) → the live card; carry the filter so the card fetches the SAME subset (SSOT —
	// one data path: vibe → /api/data/todos → crud, the filter flows through). board 0107.
	return { schema: 'todos', data: args.filter ? { filter: args.filter } : undefined }
}

/**
 * Resolve a model-supplied id against the LIVE rows. gemma can't reliably copy a 36-char UUID — it
 * hallucinates plausible ones, so the update/delete silently misses AND the diff loses its "before".
 * We show the model SHORT ids and match here by exact → prefix → shared-8-char-prefix. board 0099.
 */
function resolveId(given: string, rows: Rec[]): string {
	const g = String(given ?? '')
	const ids = rows.map((r) => String(r.id))
	return (
		ids.find((rid) => rid === g) ??
		(g.length >= 4 ? ids.find((rid) => rid.startsWith(g) || g.startsWith(rid)) : undefined) ??
		(g.length >= 6 ? ids.find((rid) => rid.slice(0, 8) === g.slice(0, 8)) : undefined) ??
		g
	)
}

export const dataCrud: ToolActor = {
	definition: DATA_CRUD_TOOL,
	async handle(ctx, raw): Promise<ToolResult> {
		const args = raw as DataCrudArgs
		const schema = typeof args.schema === 'string' ? args.schema : 'data'
		const detail =
			`${typeof args.action === 'string' ? args.action : ''} ${schema}`.trim() || 'data'

		// For a todos update/delete — or a create that nests via `parent` — read the LIVE rows ONCE and
		// RESOLVE the model's id(s) against them (gemma hallucinates UUIDs / copies 8-char short ids).
		// This both makes the write hit the real row AND gives the diff/label its real "before". board 0099.
		let todosNow: Rec[] | undefined
		const wantsParent = (args.items ?? []).some((i) => (i as Rec).parent)
		if (
			schema === 'todos' &&
			(args.action === 'update' || args.action === 'delete' || (args.action === 'create' && wantsParent))
		) {
			const cur = (await ctx.data({ schema: 'todos', action: 'list' })) as { items?: Rec[] }
			todosNow = cur.items ?? []
			if (args.action === 'update' && args.items) {
				args.items = args.items.map((i) => ({
					...i,
					id: resolveId(String((i as Rec).id ?? ''), todosNow!)
				}))
			}
			if (args.action === 'delete') {
				const raw2 = (args.ids?.length ? args.ids : args.id ? [args.id] : []).map((x) => String(x))
				args.ids = raw2.map((x) => resolveId(x, todosNow!))
				args.id = undefined
			}
			// board 0112 — SUB-TASKS: `parent` must be a REAL task row id (part_of.x2). Resolve short/fuzzy
			// ids; a value that resolves to nothing and matches NO row id prefix is most likely a TITLE the
			// model smuggled in — resolve it by title too, so "parent":"file taxes" still nests correctly.
			if (args.items) {
				args.items = args.items.map((i) => {
					const p = (i as Rec).parent
					if (!p || typeof p !== 'string') return i
					const byId = resolveId(p, todosNow!)
					const hit = todosNow!.some((r) => String(r.id) === byId)
						? byId
						: String(
								todosNow!.find((r) => String(r.title ?? '').toLowerCase() === p.toLowerCase())?.id ?? p
							)
					return { ...i, parent: hit }
				})
			}
		}

		// DELETE actor — HITL: never delete without explicit confirmation. Supports a BATCH (args.ids) so
		// "delete all done" is ONE confirm for many. Snapshot each todo's title so the confirm card + the
		// todos-deleted summary can name what went. The loop shows the card; nothing runs until confirmed.
		if (args.action === 'delete') {
			const ids = (args.ids ?? []).filter((x): x is string => typeof x === 'string' && !!x)
			const byId = new Map((todosNow ?? []).map((r) => [String(r.id), String(r.title ?? '')]))
			const deleted = ids.map((id) => ({ id, title: byId.get(id) ?? '' }))
			const names = deleted.map((d) => d.title).filter(Boolean)
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

		// EDIT actor — the before→after diff reads the live rows we already fetched (ids now resolved).
		const before: Record<string, Rec> | undefined =
			schema === 'todos' && args.action === 'update'
				? Object.fromEntries((todosNow ?? []).map((r) => [String(r.id), r]))
				: undefined

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

		// PERF (board 0105/0106): the card already shows the result, so emit the human reply DIRECTLY and let
		// the loop skip the extra "confirmation" round (a full stateless re-prefill of the whole prompt). Use
		// the model's own `response` when it wrote one; otherwise supply a terse default so EVERY successful
		// action self-replies in ONE round. This is what made a read ("show me todos") feel slower than a
		// write: on a write the model fills `response` up front, but on a `list` it tends to withhold it,
		// waiting to narrate the rows — which forced a slow second round even though the card is the answer.
		// A failure still falls through to a follow-up round so the model can explain it; delete is HITL and
		// returned earlier.
		const ok = !(result && typeof result === 'object' && (result as Rec).ok === false)
		const said = typeof args.response === 'string' ? args.response.trim() : ''
		const reply = ok ? said || defaultReply(args.action, schema, args.items, result) : undefined

		return { detail, content, reply, vibe: resultVibe(args, before, result) }
	}
}
