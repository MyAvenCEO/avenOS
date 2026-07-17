import { type Kysely, sql } from 'kysely'

// board 0100 — make the Todos data_crud actors' mechanics TRANSPARENT: each node declares the generic
// "type" context (arg = "todos"), so the config aside shows HOW data_crud actually queries/mutates todos
// under the hood — the composite TypeSpec (x1–x5 projection recipe: title→task, done/due/priority→their
// predicates, owned_by) PLUS each involved atomic predicate's JSON-Schema (the AJV validation). Same
// generic mechanism as the ontology context — no per-skill UI code.

const TODOS_CONTEXT = [
	{
		label: 'Todos type — projection recipe + schemas',
		provider: 'type',
		arg: 'todos',
		note: 'How data_crud maps the flat {title,done,due,priority} ↔ the task/owned_by/done/due/prioritized x1–x5 predications, plus each predicate’s AJV JSON-Schema.'
	}
]

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'todos'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) n.context = TODOS_CONTEXT
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'todos'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'todos'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) delete n.context
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'todos'`.execute(db)
}
