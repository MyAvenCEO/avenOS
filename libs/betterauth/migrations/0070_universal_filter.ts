import { type Kysely, sql } from 'kysely'

// board 0107 — UNIVERSAL list filtering. Replace the two enumerated filter ops (todos.done / todos.open) with
// ONE generic mechanism: crud() builds a validated QuerySpec from the list op's OWN projection + a
// {field, value, op} filter, so ANY projected field (priority, due, done, title) is filterable with zero
// hardcoded vocabulary. Swap the data_crud mailbox `filter` param to the structured schema the model fills,
// and drop the now-orphaned configured filter ops.

const FILTER_PARAM = {
	type: 'object',
	description:
		'list only: narrow by ONE projected field — {"field":<priority|due|done|title>,"value":…,"op"?:eq|neq|gt|' +
		'gte|lt|lte}. medium: {"field":"priority","value":"medium"}; open: {"field":"done","value":false}; ' +
		'due≤date: {"field":"due","op":"lte","value":"2026-07-13"}.',
	properties: {
		field: { type: 'string' },
		value: {},
		op: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] }
	}
}

interface Mailbox {
	parameters?: { properties?: Record<string, unknown> }
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// the enumerated filter ops are subsumed by the universal {field,value,op} filter.
	await sql`DELETE FROM data_operations WHERE name IN ('todos.done', 'todos.open') AND user_id IS NULL`.execute(
		db
	)
	// swap the data_crud mailbox `filter` param to the structured universal filter.
	const act = await sql<{ id: string; mailbox: Mailbox | null }>`
		SELECT a.id, a.mailbox FROM actor a JOIN skill s ON a.skill_id = s.id
		WHERE s.label = 'Todos' AND a.name = 'data_crud' LIMIT 1
	`.execute(db)
	const row = act.rows[0]
	if (row) {
		const mailbox: Mailbox = row.mailbox ?? {}
		if (mailbox.parameters?.properties) mailbox.parameters.properties.filter = FILTER_PARAM
		await sql`UPDATE actor SET mailbox = ${JSON.stringify(mailbox)}::jsonb, updated_at = now() WHERE id = ${row.id}`.execute(
			db
		)
	}
}

export async function down(): Promise<void> {}
