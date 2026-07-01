import { type Kysely, sql } from 'kysely'

// board 0099 — strip avenOS back to a resilient core: ONE Todos skill on the actor model. This drops
// every non-todos vertical from the admin config + the user data store (the code strip landed in the
// same board). Forward-only; aven-db CRDT untouched.
//
//   1. flows — remove all document/finance flows (book, capture, capture-bank, doc-ingest, invoice,
//      kontoauszug, project-planner). The Todos skill is an ACTOR HUB driven through the chat's
//      data_crud tool (see @avenos/skills/tools), not the flow runner, so no todos flow is needed.
//   2. predicate_type — un-register company/person/transaction/document/invoice (todos stays).
//   3. data — hard-delete every value + schema for a predicate used EXCLUSIVELY by those verticals.
//      `owned_by` + `due` are SHARED with todos, so instead of dropping them we orphan-clean: delete
//      only the rows whose owned/dated entity no longer exists (i.e. pointed at a just-deleted vertical).
//   4. vibe registry — keep only the todos vibe (defensive; the registry only ever seeded todos).

// predicates used ONLY by the dropped verticals (NOT by todos: task/owned_by/done/due/prioritized).
const DOOMED_PREDS = [
	'address', 'balance', 'booked', 'company', 'contact', 'dated', 'description', 'document',
	'identifier', 'invoice', 'invoice_doc', 'kind', 'line', 'line_amount', 'matched', 'name',
	'paid_on', 'payment', 'person', 'produced', 'quantity', 'represents', 'source', 'summary',
	'total', 'transaction', 'unit_price', 'value_dated'
]

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. flows
	await sql`DELETE FROM flow WHERE id IN ('book','capture','capture-bank','doc-ingest','invoice','kontoauszug','project-planner','invoice-ingest','invoice-processing')`.execute(db)

	// 2. composite type registry
	await sql`DELETE FROM predicate_type WHERE type IN ('company','person','transaction','document','invoice','line','payment')`.execute(db)

	// 3. exclusive-vertical data: values first (FK-free jsonb, but delete children before schemas)
	await sql`DELETE FROM data_value WHERE schema_id IN (SELECT id FROM data_schema WHERE name = ANY(${DOOMED_PREDS}))`.execute(db)
	await sql`DELETE FROM data_schema WHERE name = ANY(${DOOMED_PREDS})`.execute(db)

	// 3b. orphan-clean the SHARED predicates: an owned_by / due row whose linked entity (x2) is gone now
	// belonged to a deleted vertical. Todos rows survive because their task primary survives. board 0099.
	await sql`
		DELETE FROM data_value
		WHERE schema_id IN (SELECT id FROM data_schema WHERE name IN ('owned_by','due'))
		  AND data ? 'x2'
		  AND data->>'x2' NOT IN (SELECT id FROM data_value)
	`.execute(db)

	// 4. vibe registry — todos only
	for (const tbl of ['vibe_view', 'vibe_style', 'vibe_logic']) {
		await sql`DELETE FROM ${sql.raw(tbl)} WHERE name <> 'todos'`.execute(db)
	}
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only: the stripped verticals are not restored.
}
