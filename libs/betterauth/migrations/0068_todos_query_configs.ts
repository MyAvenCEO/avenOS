import { randomUUID } from 'node:crypto'
import { type Kysely, sql } from 'kysely'
import { DATA_CRUD_CODE } from '../src/todos-code'

// board 0107 — the Todos skill's FIXED SET of configured universal queries. Each is a data_operations row
// (config-as-data) DERIVED from todos.list (identical joins + projection) + ONE where clause in the
// universal query grammar (a join-targeted filter with a null op). "show me done todos" runs the configured
// `todos.done`; "open todos" → `todos.open`; a plain list → `todos.list`. No per-request GLM authoring on
// Todos and no hardcoded SQL — the data_crud `list` action selects the op by its `filter` arg
// (schema + '.' + filter). The dynamic GLM `query` (Ontology skill) still handles novel/ad-hoc questions.

// `done` is join index 1 in todos.list (owned_by=0, done=1, due=2, prioritized=3); its presence ⇔ done.
const DERIVED: Record<string, Record<string, unknown>[]> = {
	'todos.done': [{ join: 1, place: 'id', op: 'notnull' }],
	'todos.open': [{ join: 1, place: 'id', op: 'isnull' }]
}

interface Mailbox {
	parameters?: { properties?: Record<string, unknown> }
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// derive from the canonical global list op so projection/joins stay in lockstep with todos.list.
	const base = await sql<{ spec: unknown }>`
		SELECT spec FROM data_operations WHERE name = 'todos.list' AND user_id IS NULL LIMIT 1
	`.execute(db)
	const listSpec = base.rows[0]?.spec as Record<string, unknown> | undefined
	if (!listSpec) throw new Error('[0068] todos.list op not found — run the earlier todos seeds first')

	for (const [name, where] of Object.entries(DERIVED)) {
		const spec = { ...listSpec, name, where }
		await sql`DELETE FROM data_operations WHERE name = ${name} AND user_id IS NULL`.execute(db)
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, ${name}, 'query', ${JSON.stringify(spec)}::jsonb, now(), now())
		`.execute(db)
	}

	// data_crud (config-as-data): the list action learns the `filter` arg on its mailbox, and its behavior
	// gains op-by-filter selection — re-seed the actor `code` from the updated DATA_CRUD_CODE.
	const act = await sql<{ id: string; mailbox: Mailbox | null }>`
		SELECT a.id, a.mailbox FROM actor a JOIN skill s ON a.skill_id = s.id
		WHERE s.label = 'Todos' AND a.name = 'data_crud' LIMIT 1
	`.execute(db)
	const row = act.rows[0]
	if (row) {
		const mailbox: Mailbox = row.mailbox ?? {}
		const props = mailbox.parameters?.properties
		if (props && !props.filter) {
			props.filter = {
				type: 'string',
				description:
					'list only: a configured view to narrow the list. "done" = completed, "open" = not done; omit (or "all") for everything.'
			}
		}
		await sql`
			UPDATE actor SET mailbox = ${JSON.stringify(mailbox)}::jsonb, code = ${DATA_CRUD_CODE}, updated_at = now()
			WHERE id = ${row.id}
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	for (const name of Object.keys(DERIVED))
		await sql`DELETE FROM data_operations WHERE name = ${name} AND user_id IS NULL`.execute(db)
	// The mailbox `filter` prop + re-seeded code are harmless to leave; a precise revert would restore 0066's code.
}
