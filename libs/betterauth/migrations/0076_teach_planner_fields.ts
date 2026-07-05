import { type Kysely, sql } from 'kysely'

// board 0112 — LIVE FINDING from the battle test: asked for sub-tasks, gemma set goal="<parent TITLE>"
// instead of parent=<task id>, because the data_crud mailbox never taught the goal/parent item fields.
// Teach them on the items description (goal = a GROUP NAME label; parent = the PARENT TASK'S ID, never a
// title) — the tool-actor now also resolves short/title parents against the live rows server-side.

const ITEMS_DESC =
	'create: value objects — todos fields: title, done, due (ISO date), priority, goal (a GROUP NAME ' +
	'label, e.g. "Fitness"), parent (a SUB-TASK: the id of the parent task from CURRENT TODOS — an id, ' +
	'NEVER a title; use goal for named groups instead). update: same fields plus the item\'s "id" — ' +
	'pass MANY to edit several at once.'

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor SET mailbox = jsonb_set(
			mailbox,
			'{parameters,properties,items,description}',
			to_jsonb(${ITEMS_DESC}::text)
		), updated_at = now()
		WHERE name = 'data_crud'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor SET mailbox = jsonb_set(
			mailbox,
			'{parameters,properties,items,description}',
			to_jsonb(${'create: value objects (e.g. {"title":"Buy milk"}). update: objects including their "id" — pass MANY to edit several at once.'}::text)
		), updated_at = now()
		WHERE name = 'data_crud'
	`.execute(db)
}
