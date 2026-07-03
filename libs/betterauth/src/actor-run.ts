import { sql } from 'kysely'
import { type Caps, runActorCode } from './actor-sandbox'
import type { DataCrudArgs } from '@avenos/skills/tools'
import { type ActorRow, engineFor } from './config'
import { db } from './db'
import { type OperationRow, runOperation } from './queries'

// board 0111 — the actor RUNNER. An actor's behavior is bound either as sandboxed `code` (QuickJS-in-WASM,
// this card) or a by-name `engine` (the code registry, board 0110). A `code` actor runs in the sandbox with
// ONLY the capabilities its `caps` list grants, each wired here to a real host function. This is the SSOT
// seam: the chat tool loop AND the vibe UI post to the SAME actor row's mailbox.

/** Run a named `data_operations` row (query or mutation) with params — the `ops` capability. */
async function runNamedOp(
	uid: string,
	name: string,
	params: Record<string, unknown>
): Promise<unknown> {
	const r = await sql`
		SELECT id, name, kind, spec FROM data_operations
		WHERE name = ${name} AND (user_id = ${uid} OR user_id IS NULL)
		ORDER BY (user_id IS NULL) ASC LIMIT 1
	`.execute(db())
	const row = r.rows[0] as OperationRow | undefined
	if (!row) throw new Error(`ops: no operation "${name}"`)
	return runOperation(uid, row, params)
}

/** Build the capability object an actor is allowed, from its declared `caps` list. Only granted names get a
 *  host function; everything else is absent (so the sandbox fails closed). board 0111. */
export function buildCaps(uid: string, capList: string[] | null): Caps {
	const want = new Set(capList ?? [])
	const caps: Caps = {}
	if (want.has('ops')) {
		caps.ops = (name: unknown, params: unknown) =>
			runNamedOp(uid, String(name), (params as Record<string, unknown>) ?? {})
	}
	return caps
}

export type CodeRunResult = { ran: true; result: unknown } | { ran: false }

/**
 * If the actor carries sandboxed `code`, run it in the sandbox (with its granted caps + its prompt/ctx) and
 * return the result. If it has no code (an `engine` actor), return `{ ran: false }` so the caller falls back
 * to the existing by-name engine dispatch. board 0111.
 */
export async function runCodeActor(
	actor: Pick<ActorRow, 'name' | 'code' | 'caps' | 'prompt' | 'engine'>,
	msg: unknown,
	uid: string
): Promise<CodeRunResult> {
	if (!actor.code) return { ran: false }
	const result = await runActorCode(actor.code, msg, buildCaps(uid, actor.caps), {
		prompt: actor.prompt ?? ''
	})
	return { ran: true, result }
}

/** Behavior is bound as `code` XOR `engine`. Resolve which one an actor uses (for the runner + the viewer). */
export function actorBinding(actor: Pick<ActorRow, 'code' | 'engine'>): 'code' | 'engine' | 'none' {
	if (actor.code) return 'code'
	if (actor.engine && engineFor(actor.engine)) return 'engine'
	return 'none'
}

/**
 * board 0107 — the ONE data-CRUD executor. CRUD is not special: list/create/update/delete + a configured
 * `filter` are just NAMED operations (`<schema>.<verb>` rows in data_operations, query or mutation specs)
 * run through the universal engine. Every caller — the chat tool loop, the delete-confirm path, and the
 * /api/data REST handlers — dispatches here; there is no separate sandbox-code / typeSpec / raw-jsonb path.
 * Config-as-data SSOT: the available verbs (and list filters like `todos.done`) ARE the seeded ops.
 */
export async function crud(uid: string, args: DataCrudArgs): Promise<unknown> {
	const schema = args.schema
	if (!schema) return { ok: false, error: 'schema name required' }
	const op = (verb: string) => `${schema}.${verb}`
	const action = args.action ?? 'list'

	if (action === 'list') {
		const view = args.filter && args.filter !== 'all' ? op(args.filter) : op('list')
		const res = (await runNamedOp(uid, view, {})) as { rows?: unknown[] }
		return { ok: true, action: 'list', items: res.rows ?? [] }
	}
	if (action === 'create') {
		const created: string[] = []
		for (const item of args.items ?? []) {
			const res = (await runNamedOp(uid, op('create'), item as Record<string, unknown>)) as {
				ids?: (string | null)[]
			}
			const id = res.ids?.[0]
			if (id) created.push(id)
		}
		return { ok: true, action: 'create', created, errors: [] }
	}
	if (action === 'update') {
		const updated: string[] = []
		for (const item of args.items ?? []) {
			const id = (item as { id?: string }).id
			if (!id) continue
			await runNamedOp(uid, op('update'), item as Record<string, unknown>)
			updated.push(id)
		}
		return { ok: true, action: 'update', updated, errors: [] }
	}
	if (action === 'delete') {
		const ids = args.ids ?? (args.id ? [args.id] : [])
		if (ids.length === 0) return { ok: false, error: 'delete requires id(s)' }
		for (const id of ids) await runNamedOp(uid, op('delete'), { id })
		return { ok: true, action: 'delete', deleted: ids }
	}
	return { ok: false, error: `unknown action: ${String(args.action)}` }
}
