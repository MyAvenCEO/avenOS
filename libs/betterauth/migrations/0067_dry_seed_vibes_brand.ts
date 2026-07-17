import { type Kysely, sql } from 'kysely'
import { cardStyle, todoLogic, todoStyle, todoView } from '@avenos/aven-vibes'

// board 0111 — DRY SSOT re-seed of the vibe registry (view/style/logic live in Postgres; the app reads them
// via loadVibeBundle). The interim brand restyle + Clash/Azeret font fix had been applied with ad-hoc runtime
// UPDATEs; this migration folds every one of them back into a reproducible seed sourced from the aven-vibes
// TS SSOT, so a fresh `migrate` reproduces the styled state end-to-end:
//   · todos       → re-seeded from todoView/todoStyle/todoLogic (picks up the list restyle + withBrand fonts).
//   · the 8 cards → share the restyled `cardStyle` (brand palette, ✳ sparkle header, Clash titles, a bordered
//                   surface list-card with divider rows), so create/edit/delete look like the todos list.
//   · the 3 todos-summary VIEWS → colour-coded priority pills (created), stacked diff rows (edited), a
//                   terracotta ✕ strike (deleted).

// Card names whose vibe_style row shares the one restyled brand style.
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

// A read-only card fires no events; a no-op handleEvent keeps the QuickJS contract satisfied.
const NOOP = '\nfunction handleEvent(t, p, s) { return s }\n'

// created: title + a right-aligned trailing group (due chip · colour-coded priority pill).
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
const TODOS_CREATED_LOGIC = `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var t=it[i]||{};out.push({title:t.title||'\\u2014',due:t.due?String(t.due):'',priority:t.priority?String(t.priority):''});}return{count:out.length+' Aufgabe(n)',items:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}${NOOP}`

// edited: a stacked divider row — title over the change line.
const TODOS_EDITED_VIEW = {
	content: {
		class: 'vc-root',
		children: [
			{
				class: 'vc-header',
				children: [
					{ class: 'vc-dot' },
					{ text: 'Aktualisiert', class: 'vc-eyebrow' },
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
							items: '$diffs',
							template: {
								tag: 'li',
								class: 'vc-row vc-row--stack',
								children: [
									{ text: '$$title', class: 'vc-pred' },
									{
										class: 'vc-diff',
										children: [
											{ text: '$$field', class: 'vc-diff-field' },
											{ text: '$$from', class: 'vc-diff-from' },
											{ text: '→', class: 'vc-diff-arrow' },
											{ text: '$$to', class: 'vc-diff-to' },
											{ text: '$$more', class: 'vc-diff-more' }
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

// edited logic: emit the primary change as FIELD / FROM / TO (+ "N more" when a diff has several), so the
// view can render a structured before→after instead of a flat joined string. board 0111.
const TODOS_EDITED_LOGIC = `function initState(source){source=source||{};var df=source.diffs||[];var out=[];for(var i=0;i<df.length;i++){var d=df[i]||{};var ch=d.changes||[];var f=ch[0]||{};out.push({title:d.title||'\\u2014',field:f.field||'',from:(f.from==null||f.from==='')?'\\u2014':String(f.from),to:(f.to==null||f.to==='')?'\\u2014':String(f.to),more:ch.length>1?('+'+(ch.length-1)+' more'):''});}return{count:out.length+' Aufgabe(n)',diffs:out,emptyMsg:out.length?'':'Keine \\u00c4nderungen.'};}${NOOP}`

// deleted: a terracotta ✕ marker + struck title.
const TODOS_DELETED_VIEW = {
	content: {
		class: 'vc-root',
		children: [
			{
				class: 'vc-header',
				children: [
					{ class: 'vc-dot vc-dot--red' },
					{ text: 'Gelöscht', class: 'vc-eyebrow vc-eyebrow--red' },
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
									{ text: '✕', class: 'vc-x' },
									{ text: '$$title', class: 'vc-strike' }
								]
							}
						}
					}
				]
			}
		]
	}
}

async function upsertJson(
	db: Kysely<unknown>,
	table: 'vibe_view' | 'vibe_style',
	name: string,
	value: unknown
): Promise<void> {
	const body = JSON.stringify(value)
	await sql`
		INSERT INTO ${sql.raw(table)} (name, body) VALUES (${name}, ${body}::jsonb)
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
	// todos — SSOT = aven-vibes TS (list restyle + withBrand Clash/Azeret fonts).
	await upsertJson(db, 'vibe_view', 'todos', todoView)
	await upsertJson(db, 'vibe_style', 'todos', todoStyle)
	await upsertLogic(db, 'todos', todoLogic)

	// every read-only card shares the restyled brand card style.
	for (const name of CARD_STYLE_NAMES) await upsertJson(db, 'vibe_style', name, cardStyle)

	// the three todos-summary views + created logic (colour-coded pills / stacked diffs / ✕ strike).
	await upsertJson(db, 'vibe_view', 'todos-created', TODOS_CREATED_VIEW)
	await upsertLogic(db, 'todos-created', TODOS_CREATED_LOGIC)
	await upsertJson(db, 'vibe_view', 'todos-edited', TODOS_EDITED_VIEW)
	await upsertLogic(db, 'todos-edited', TODOS_EDITED_LOGIC)
	await upsertJson(db, 'vibe_view', 'todos-deleted', TODOS_DELETED_VIEW)
}

// Forward-only brand re-seed: the prior definitions live in 0034 (todos) and 0063 (cards). A precise revert
// would duplicate those bodies here; in this dev/next environment re-running 0034/0063 restores them, so the
// down is a documented no-op rather than a stale copy that could drift.
export async function down(): Promise<void> {}
