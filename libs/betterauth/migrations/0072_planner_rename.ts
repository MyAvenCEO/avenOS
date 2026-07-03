import { type Kysely, sql } from 'kysely'

// board 0112 — the Todos skill becomes the general **Planner** (it gains goals, tags and sub-tasks in the
// battle-test extension). WIRE-STABLE rename (the 0040 lesson): the skill ID stays `todos` — as do the
// bundle type, the `todos.*` op names and the vibe names — only the human/router-facing label and the
// routing description change. The dispatch router routes on this description, so it names the new powers.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE skill SET
			label = 'Planner',
			description = ${"the user's planner — todos/tasks with goals, tags, sub-tasks, priorities and due dates: list, add, complete, edit, delete, or group them"},
			updated_at = now()
		WHERE id = 'todos'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE skill SET
			label = 'Todos',
			description = ${"the user's task list — list, add, complete, edit, or delete todos and tasks"},
			updated_at = now()
		WHERE id = 'todos'
	`.execute(db)
}
