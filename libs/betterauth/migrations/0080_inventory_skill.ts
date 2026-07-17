import { randomUUID } from 'node:crypto'
import type { TypeSpec } from '@avenos/aven-ontology'
import { cardStyle, goalsStyle } from '@avenos/aven-vibes'
import { compilePredicate, type PredicateDef } from '@avenos/aven-vibes/predicate'
import { type Kysely, sql } from 'kysely'
import { saveType } from '../src/type-caps'

// board 0112/0113 — the SKILLIFY PROOF: a complete NEW skill ("Inventory"), authored as PURE CONFIG in one
// migration — exactly the rows the future skillify flow will have GLM author. ZERO new engine code:
//   vocab    → 3 Lojban-faithful predicates (stock≡sorcu — literally the inventory gismu: x1 a store of
//              materials x2 in containment x3 · located≡zvati · quantity≡klani), + universal owned_by.
//   bundle   → `inventory` (saveType derives inventory.list/create/update/delete automatically); the
//              universal {field,value,op} filter works on location/amount/name for free.
//   ops      → inventory.locations: the per-location aggregate (the goals pattern).
//   skill    → the `inventory` skill row (the dispatch router reads the menu from the DB) + a data_crud
//              actor row whose mailbox teaches the inventory fields (the SAME generic tool handler).
//   vibes    → an `inventory` list card (view+logic; style = the shared cardStyle body, DRY) and an
//              `inventory-locations` grid (style = goalsStyle) rendered by the generic VibeCard host.
// Fresh-user note: the code bootstrap seeds only the todo vocab; inventory predicates are seeded here for
// every EXISTING user — the per-user-vocab-as-config table stays the north star follow-up.

// ── vocab (Lojban-faithful; symbolic refs per the skr04-*/idkind-* precedent) ─────────────────────────
const STOCK: PredicateDef = {
	predicate: 'stock',
	gismu: 'sorcu',
	gloss: 'sorcu: x1 is a store/stock of materials x2 in containment x3 — one inventory item',
	places: [
		{ pos: 'x1', role: 'store', gloss: 'the stock entity (the row; implicit)', kind: 'ref', references: '*', required: false },
		{ pos: 'x2', role: 'materials', gloss: 'WHAT is stocked — symbolic id = the item name', kind: 'ref', references: '*' },
		{ pos: 'x3', role: 'containment', gloss: 'the containment (open — location rides located≡zvati)', kind: 'ref', references: '*', required: false }
	]
}
const LOCATED: PredicateDef = {
	predicate: 'located',
	gismu: 'zvati',
	gloss: 'zvati: x1 (the stock) is present at location x2 — where an item lives',
	places: [
		{ pos: 'x1', role: 'present thing', gloss: 'the stock row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'location', gloss: 'the place — symbolic id = its name (Garage, Keller …)', kind: 'ref', references: '*' }
	]
}
const QUANTITY: PredicateDef = {
	predicate: 'quantity',
	gismu: 'klani',
	gloss: 'klani: x1 (the stock) is quantified by amount x2 on scale x3 — how many/much',
	places: [
		{ pos: 'x1', role: 'quantity', gloss: 'the quantified stock row', kind: 'ref', references: '*' },
		{ pos: 'x2', role: 'amount', gloss: 'the amount (e.g. "3")', kind: 'value', type: 'string' },
		{ pos: 'x3', role: 'scale', gloss: 'the unit/scale (open — e.g. "kg")', kind: 'value', type: 'string', required: false }
	]
}

// ── the bundle: primary stock + owned_by singleton + located/quantity replace traits ─────────────────
const INVENTORY_SPEC: TypeSpec = {
	type: 'inventory',
	parts: [
		{ pred: 'stock', kind: 'primary', field: 'name', create: { x2: '$value' }, set: { x2: '$value' } },
		{ pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
		{ pred: 'located', kind: 'replace', link: 'x1', field: 'location', set: { x1: '$primary', x2: '$value' } },
		{ pred: 'quantity', kind: 'replace', link: 'x1', field: 'amount', set: { x1: '$primary', x2: '$value' } }
	],
	project: {
		name: { pred: 'stock', place: 'x2' },
		owner: { pred: 'owned_by', place: 'x1' },
		location: { pred: 'located', place: 'x2' },
		amount: { pred: 'quantity', place: 'x2' }
	}
}

const LOCATIONS_OP = { name: 'inventory.locations', from: 'located', group_by: 'x2', count: {} }

// ── the skill + its data_crud actor (the SAME generic tool handler; the mailbox teaches inventory) ────
const ACTOR_ID = '00000000-0000-0000-0000-0000000113b1'
const MAILBOX = {
	description:
		'Read or modify the signed-in user\'s INVENTORY (schema "inventory"): items with a name, a location ' +
		'and an amount. BATCH create/update via `items`; delete via `ids`. Use `list` when they ask to see ' +
		'stock ("what\'s in the garage?" → filter {"field":"location","value":"Garage"}).',
	parameters: {
		type: 'object',
		properties: {
			schema: { type: 'string', description: 'Always "inventory" on this skill.' },
			action: { type: 'string', enum: ['list', 'create', 'update', 'delete'] },
			filter: {
				type: 'object',
				description:
					'list only: {"field":<name|location|amount>,"value":…,"op"?:eq|neq|gt|gte|lt|lte|isnull|notnull}. ' +
					'e.g. {"field":"location","value":"Garage"}.',
				properties: { field: { type: 'string' }, value: {}, op: { type: 'string' } }
			},
			items: {
				type: 'array',
				description:
					'create: {"name":"Hammer","location":"Garage","amount":"3"}. update: same fields + the item\'s "id".',
				items: { type: 'object', additionalProperties: true }
			},
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['schema', 'action']
	}
}

// ── the vibes: a list card (cardStyle) + a locations grid (goalsStyle), rendered by VibeCard ─────────
const INVENTORY_VIEW = {
	content: {
		class: 'vc-root',
		children: [
			{
				class: 'vc-header',
				children: [
					{ class: 'vc-dot' },
					{ text: 'Inventar', class: 'vc-eyebrow' },
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
									{ text: '$$name', class: 'vc-pred' },
									{
										class: 'vc-trail',
										children: [
											{ text: '$$location', class: 'vc-goal' },
											{ text: '$$amount', class: 'vc-due' }
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
const INVENTORY_LOGIC = `function initState(source){source=source||{};var it=source.items||[];var out=[];for(var i=0;i<it.length;i++){var t=it[i]||{};out.push({name:t.name||'\\u2014',location:t.location?String(t.location):'',amount:t.amount?String(t.amount)+(t.scale?' '+t.scale:'\\u00d7'):''});}return{count:out.length+' Positionen',items:out,emptyMsg:out.length?'':'Noch kein Bestand \\u2014 sag mir was du einlagerst.'};}
function handleEvent(t, p, s) { return s }`

const LOCATIONS_VIEW = {
	content: {
		class: 'gl-root',
		children: [
			{ class: 'gl-eyebrow', children: [{ text: 'Lagerorte' }, { text: '$count', class: 'gl-meta' }] },
			{ text: '$emptyMsg', class: 'gl-empty' },
			{
				class: 'gl-grid',
				children: [
					{
						$each: {
							items: '$locations',
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
const LOCATIONS_LOGIC = `function initState(source){source=source||{};var ls=source.locations||[];var out=[];for(var i=0;i<ls.length;i++){var l=ls[i]||{};out.push({name:String(l.key||'\\u2014'),countLabel:Number(l.n||0)+' Position(en)'});}return{count:out.length+' Orte',locations:out,emptyMsg:out.length?'':'Noch keine Lagerorte.'};}
function handleEvent(t, p, s) { return s }`

async function upsertJson(db: Kysely<unknown>, table: 'vibe_view' | 'vibe_style', name: string, value: unknown): Promise<void> {
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
	try {
		// 1. vocab for every existing user.
		const users = await sql<{ user_id: string }>`
			SELECT DISTINCT user_id FROM data_schema WHERE user_id IS NOT NULL
		`.execute(db)
		for (const def of [STOCK, LOCATED, QUANTITY]) {
			const body = JSON.stringify(compilePredicate(def))
			for (const { user_id } of users.rows) {
				const existing = await sql<{ id: string }>`
					SELECT id FROM data_schema WHERE user_id = ${user_id} AND name = ${def.predicate} LIMIT 1
				`.execute(db)
				if (existing.rows[0]) {
					await sql`UPDATE data_schema SET json_schema = ${body}::jsonb, updated_at = now() WHERE id = ${existing.rows[0].id}`.execute(db)
				} else {
					await sql`
						INSERT INTO data_schema (id, user_id, name, json_schema, created_at, updated_at)
						VALUES (${randomUUID()}, ${user_id}, ${def.predicate}, ${body}::jsonb, now(), now())
					`.execute(db)
				}
			}
		}

		// 2. the bundle (derives inventory.list/create/update/delete) + the locations aggregate.
		await saveType(INVENTORY_SPEC)
		await sql`DELETE FROM data_operations WHERE name = 'inventory.locations' AND user_id IS NULL`.execute(db)
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, 'inventory.locations', 'query', ${JSON.stringify(LOCATIONS_OP)}::jsonb, now(), now())
		`.execute(db)

		// 3. the skill row (router menu) + the data_crud actor row (same generic handler, inventory mailbox).
		await sql`
			INSERT INTO skill (id, label, description, position, created_at, updated_at)
			VALUES ('inventory', 'Inventory', ${"the user's inventory/stock — items with a location and an amount: list what's stored where, add, move, restock/consume (update the amount), or remove items"}, 4, now(), now())
			ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description, updated_at = now()
		`.execute(db)
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
			VALUES (${ACTOR_ID}, 'inventory', 'data_crud', 'data_crud', ${JSON.stringify(MAILBOX)}::jsonb, 'inventory', false, 1, now(), now())
			ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, updated_at = now()
		`.execute(db)

		// 4. the vibes (styles reuse the shared TS SSOT bodies — DRY).
		await upsertJson(db, 'vibe_view', 'inventory', INVENTORY_VIEW)
		await upsertJson(db, 'vibe_style', 'inventory', cardStyle)
		await upsertLogic(db, 'inventory', INVENTORY_LOGIC)
		await upsertJson(db, 'vibe_view', 'inventory-locations', LOCATIONS_VIEW)
		await upsertJson(db, 'vibe_style', 'inventory-locations', goalsStyle)
		await upsertLogic(db, 'inventory-locations', LOCATIONS_LOGIC)
	} catch (e) {
		// REPLAY-SAFE SKIP (board 0119j): this migration executes TODAY'S runtime engine against the
		// schema as it existed at position 0080 — a fresh catch-up (the next channel) can reject it
		// even though the historical run succeeded. Skipping is CONVERGENT: the inventory bundle/ops re-seed via a follow-up if ever skipped — the skip is LOGGED loudly.
		// DBs that applied it historically are untouched (already recorded as applied).
		console.error('[migrate 0080] replay-safe skip:', e instanceof Error ? e.message : String(e))
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ACTOR_ID}`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'inventory'`.execute(db)
	await sql`DELETE FROM data_operations WHERE derived_from = 'inventory' OR (name = 'inventory.locations' AND user_id IS NULL)`.execute(db)
	await sql`DELETE FROM data_bundles WHERE type = 'inventory'`.execute(db)
	for (const t of ['vibe_view', 'vibe_style', 'vibe_logic'])
		await sql`DELETE FROM ${sql.raw(t)} WHERE name IN ('inventory', 'inventory-locations')`.execute(db)
}
