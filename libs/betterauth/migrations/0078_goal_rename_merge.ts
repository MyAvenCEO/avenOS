import { randomUUID } from 'node:crypto'
import { type Kysely, sql } from 'kysely'

// board 0112 — LIVE FINDING: "merge the two goals" — the Planner had no way to express it, so gemma
// correctly offered a manual task-move. A merge IS one universal mutation: move every membership from
// one goal label to another (UPDATE member_of SET x2=to WHERE x2=from) — which also covers RENAMING a
// goal (renaming onto an existing name = merging). One configured op, two features, zero engine code.
// The goals actor gains an optional `rename:{from,to}` argument that runs it and returns the fresh grid.

const RENAME_OP = {
	name: 'todos.goal-rename',
	params: ['from', 'to'],
	ops: [
		{
			op: 'update',
			predicate: 'member_of',
			where: [{ place: 'x2', op: 'eq', param: 'from' }],
			cells: { x2: { param: 'to' } }
		}
	]
}

const MAILBOX = {
	description:
		"Show the user's GOALS — the named groups their todos cluster under — as a grid of goal cards with " +
		'done/total progress. Use when they ask to see their goals/projects/groups. Pass rename:{from,to} to ' +
		'RENAME a goal or MERGE it into an existing one (all its tasks move to `to`). For the tasks INSIDE ' +
		'one goal use data_crud list with {"field":"goal","value":<name>}.',
	parameters: {
		type: 'object',
		properties: {
			rename: {
				type: 'object',
				description:
					'rename/merge: every task in goal `from` moves to goal `to` (merging when `to` already exists).',
				properties: { from: { type: 'string' }, to: { type: 'string' } },
				required: ['from', 'to']
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goal-rename' AND user_id IS NULL`.execute(db)
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		VALUES (${randomUUID()}, NULL, 'todos.goal-rename', 'mutation', ${JSON.stringify(RENAME_OP)}::jsonb, now(), now())
	`.execute(db)
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(MAILBOX)}::jsonb, updated_at = now()
		WHERE skill_id = 'todos' AND name = 'goals'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goal-rename' AND user_id IS NULL`.execute(db)
}
