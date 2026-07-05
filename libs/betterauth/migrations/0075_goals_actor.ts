import { randomUUID } from 'node:crypto'
import { goalsStyle } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — the Planner's GOALS actor + grid vibe, all config:
//   · `todos.goals` op — ONE universal aggregate (group_by member_of.x2 + count) in data_operations.
//   · the `goals` actor row on the Planner skill (engine-by-name → skills/tools/goals.ts, which runs the
//     op through the generic `ops` capability and points at the vibe).
//   · the `goals` vibe rows — a responsive grid of brand goal tiles (name + task count), rendered by the
//     generic VibeCard host like every other read-only card.

const ACTOR_ID = '00000000-0000-0000-0000-0000000112a1'
const MAILBOX = {
	description:
		"Show the user's GOALS — the named groups their todos cluster under — as a grid of goal cards " +
		'with task counts. Use when they ask to see their goals/projects/groups (any wording). For the ' +
		'tasks INSIDE one goal use data_crud list with {"field":"goal","value":<name>}.',
	parameters: {
		type: 'object',
		properties: {
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

const GOALS_OP = { name: 'todos.goals', from: 'member_of', group_by: 'x2', count: {} }

const GOALS_VIEW = {
	content: {
		class: 'gl-root',
		children: [
			{
				class: 'gl-eyebrow',
				children: [{ text: 'Goals' }, { text: '$count', class: 'gl-meta' }]
			},
			{ text: '$emptyMsg', class: 'gl-empty' },
			{
				class: 'gl-grid',
				children: [
					{
						$each: {
							items: '$goals',
							template: {
								class: 'grid-card',
								children: [
									{ text: '$$name', class: 'grid-card-title' },
									{ text: '$$countLabel', class: 'gl-count' }
								]
							}
						}
					}
				]
			}
		]
	}
}

const GOALS_LOGIC = `function initState(source){source=source||{};var gs=source.goals||[];var out=[];for(var i=0;i<gs.length;i++){var g=gs[i]||{};var n=Number(g.n||0);out.push({name:String(g.key||'\\u2014'),countLabel:n+' Aufgabe'+(n===1?'':'n')});}return{count:out.length+' Ziele',goals:out,emptyMsg:out.length?'':'Noch keine Ziele \\u2014 h\\u00e4nge ein Todo an ein Ziel ("\\u2026 f\\u00fcr mein Fitness-Ziel").'};}
function handleEvent(t, p, s) { return s }`

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the aggregate op.
	await sql`DELETE FROM data_operations WHERE name = 'todos.goals' AND user_id IS NULL`.execute(db)
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		VALUES (${randomUUID()}, NULL, 'todos.goals', 'query', ${JSON.stringify(GOALS_OP)}::jsonb, now(), now())
	`.execute(db)

	// 2. the actor row on the Planner skill (engine-by-name; vibe = 'goals').
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${ACTOR_ID}, 'todos', 'goals', 'goals', ${JSON.stringify(MAILBOX)}::jsonb, 'goals', false, 2, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
	`.execute(db)

	// 3. the vibe rows (view/style/logic).
	for (const [table, body] of [
		['vibe_view', JSON.stringify(GOALS_VIEW)],
		['vibe_style', JSON.stringify(goalsStyle)]
	] as const) {
		await sql`
			INSERT INTO ${sql.raw(table)} (name, body) VALUES ('goals', ${body}::jsonb)
			ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
		`.execute(db)
	}
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES ('goals', ${GOALS_LOGIC})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goals' AND user_id IS NULL`.execute(db)
	await sql`DELETE FROM actor WHERE id = ${ACTOR_ID}`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name = 'goals'`.execute(db)
}
