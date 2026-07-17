import { randomUUID } from 'node:crypto'
import { cardStyle, goalsStyle } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — two live-feedback upgrades, all config:
//   · the CREATED card shows the row's FULL badges: ✳ goal chip · ◷ due · priority pill · ↳ sub-task
//     marker (the data-crud todoItem now carries goal/sub).
//   · the GOALS grid gets a done/total PROGRESS BAR: a second universal aggregate (todos.goals-done —
//     memberships inner-joined to the done satellite, grouped per goal) merged by the goals actor; the
//     fill width is a discrete p0…p100 class (the sandbox forbids inline styles).
// Re-seeds the shared card style + the goals style from the aven-vibes TS SSOT.

const CARD_STYLE_NAMES = [
	'bundle-created',
	'ontology',
	'ontology-created',
	'query-result',
	'mutation-result',
	'todos-created',
	'todos-edited',
	'todos-deleted'
]

const GOALS_DONE_OP = {
	name: 'todos.goals-done',
	from: 'member_of',
	join: [{ predicate: 'done', kind: 'inner', on: { place: 'x1', base: 'x1' } }],
	group_by: 'x2',
	count: {}
}

// created card: title + the full badge trail (goal · due · priority · sub marker).
const TODOS_CREATED_VIEW = {
	content: {
		class: 'vc-root',
		children: [
			{
				class: 'vc-header',
				children: [
					{ class: 'vc-dot vc-dot--green' },
					{ text: 'Neu erstellt', class: 'vc-eyebrow vc-eyebrow--green' },
					{ text: '$count', class: 'vc-meta' }
				]
			},
			{ text: '$emptyMsg', class: 'vc-empty' },
			{
				tag: 'ul',
				class: 'vc-list',
				children: [
					{
						$each: {
							items: '$items',
							template: {
								tag: 'li',
								class: 'vc-row',
								children: [
									{ text: '$$title', class: 'vc-pred' },
									{
										class: 'vc-trail',
										children: [
											{ text: '$$sub', class: 'vc-sub' },
											{ text: '$$goal', class: 'vc-goal' },
											{ text: '$$due', class: 'vc-due' },
											{ text: '$$priority', class: 'vc-prio', attrs: { 'data-prio': '$$priority' } }
										]
									}
								]
							}
						}
					}
				]
			}
		]
	}
}
const TODOS_CREATED_LOGIC = `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var t=it[i]||{};out.push({title:t.title||'\\u2014',due:t.due?String(t.due):'',priority:t.priority?String(t.priority):'',goal:t.goal?String(t.goal):'',sub:t.sub?String(t.sub):''});}return{count:out.length+' Aufgabe(n)',items:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}
function handleEvent(t, p, s) { return s }`

// goals grid: name + "done/total erledigt" + the progress bar (discrete width class).
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
									{ text: '$$countLabel', class: 'gl-count' },
									{ class: 'gl-bar', children: [{ class: '$$barClass' }] }
								]
							}
						}
					}
				]
			}
		]
	}
}
const GOALS_LOGIC = `function initState(source){source=source||{};var gs=source.goals||[];var out=[];for(var i=0;i<gs.length;i++){var g=gs[i]||{};var total=Number(g.total!=null?g.total:g.n||0);var done=Number(g.done||0);var pct=total>0?Math.round((done/total)*10)*10:0;if(pct>100)pct=100;out.push({name:String(g.key||'\\u2014'),countLabel:done+'/'+total+' erledigt',barClass:'gl-bar-fill p'+pct});}return{count:out.length+' Ziele',goals:out,emptyMsg:out.length?'':'Noch keine Ziele \\u2014 h\\u00e4nge ein Todo an ein Ziel ("\\u2026 f\\u00fcr mein Fitness-Ziel").'};}
function handleEvent(t, p, s) { return s }`

async function upsertJson(
	db: Kysely<unknown>,
	table: 'vibe_view' | 'vibe_style',
	name: string,
	value: unknown
): Promise<void> {
	await sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}
async function upsertLogic(db: Kysely<unknown>, name: string, body: string): Promise<void> {
	await sql`
		INSERT INTO vibe_logic (name, body) VALUES (${name}, ${body})
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. the done-per-goal aggregate.
	await sql`DELETE FROM data_operations WHERE name = 'todos.goals-done' AND user_id IS NULL`.execute(db)
	await sql`
		INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
		VALUES (${randomUUID()}, NULL, 'todos.goals-done', 'query', ${JSON.stringify(GOALS_DONE_OP)}::jsonb, now(), now())
	`.execute(db)

	// 2. the created card (full badges) + the goals grid (progress bar).
	await upsertJson(db, 'vibe_view', 'todos-created', TODOS_CREATED_VIEW)
	await upsertLogic(db, 'todos-created', TODOS_CREATED_LOGIC)
	await upsertJson(db, 'vibe_view', 'goals', GOALS_VIEW)
	await upsertLogic(db, 'goals', GOALS_LOGIC)

	// 3. styles from the TS SSOT (cardStyle gained .vc-goal/.vc-sub; goalsStyle gained the bar).
	for (const name of CARD_STYLE_NAMES) await upsertJson(db, 'vibe_style', name, cardStyle)
	await upsertJson(db, 'vibe_style', 'goals', goalsStyle)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name = 'todos.goals-done' AND user_id IS NULL`.execute(db)
	// views/styles revert = re-running 0067/0075.
}
