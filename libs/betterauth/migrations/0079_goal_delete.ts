import { randomUUID } from 'node:crypto'
import { type Kysely, sql } from 'kysely'

// board 0112 — goal DELETE completes the goal lifecycle (list · assign · filter · rename · merge · delete).
// Deleting a goal dissolves the GROUPING, never the tasks: one universal mutation removes its member_of
// rows (DELETE WHERE x2=<name>); every task survives, just ungrouped. Label-level and reversible by
// re-grouping — so, like merge, it is NOT HITL-gated (task deletion stays gated in data_crud).

const DELETE_OP = {
	name: 'todos.goal-delete',
	params: ['name'],
	ops: [
		{
			op: 'delete',
			predicate: 'member_of',
			where: [{ place: 'x2', op: 'eq', param: 'name' }]
		}
	]
}

const MAILBOX = {
	description:
		"Show the user's GOALS — the named groups their todos cluster under — as a grid of goal cards with " +
		'done/total progress. Use when they ask to see their goals/projects/groups. Pass rename:{from,to} to ' +
		'RENAME a goal or MERGE it into an existing one (all its tasks move to `to`). Pass remove:{name} to ' +
		'DELETE a goal — its tasks stay, they just leave the group. For the tasks INSIDE one goal use ' +
		'data_crud list with {"field":"goal","value":<name>}.',
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
			remove: {
				type: 'object',
				description: 'delete a goal by name — dissolves the grouping; the tasks themselves stay.',
				properties: { name: { type: 'string' } },
				required: ['name']
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goal-delete' AND user_id IS NULL`.execute(db)
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		VALUES (${randomUUID()}, NULL, 'todos.goal-delete', 'mutation', ${JSON.stringify(DELETE_OP)}::jsonb, now(), now())
	`.execute(db)
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(MAILBOX)}::jsonb, updated_at = now()
		WHERE skill_id = 'todos' AND name = 'goals'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goal-delete' AND user_id IS NULL`.execute(db)
}
