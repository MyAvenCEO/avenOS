import { type Kysely, sql } from 'kysely'

// board 0113 — REPAIR: migration 0094 reused the pseudo-UUIDs …0113b1/…0113b2 for the plan_app/mint_data
// step actors, but those ids belong to the INVENTORY actors (0080/0082). The ON CONFLICT upsert therefore
// OVERWROTE inventory's data_crud/locations mailboxes+vibes+positions with promotion-step config, and the
// two step actors were never created. This migration restores the inventory rows verbatim and creates the
// two step actors under FRESH ids. Lesson: hand-rolled pseudo-UUIDs must be globally unique per row.

const INV_DATA_CRUD = '00000000-0000-0000-0000-0000000113b1'
const INV_LOCATIONS = '00000000-0000-0000-0000-0000000113b2'
const PLAN_APP_ID = '00000000-0000-0000-0000-0000000113c1'
const MINT_DATA_ID = '00000000-0000-0000-0000-0000000113c2'

const INV_CRUD_MAILBOX = {
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
					'create: {"name":"Hammer","location":"Garage","amount":"3"}. To MOVE an item, update it with a new ' +
					'"location" (a place name — a new place is created automatically). To restock, update its "amount". ' +
					'update: the fields to change + the item\'s "id" (or its name — it is resolved to the row).',
				items: { type: 'object', additionalProperties: true }
			},
			id: { type: 'string' },
			ids: { type: 'array', items: { type: 'string' } },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['schema', 'action']
	}
}
const INV_LOCATIONS_MAILBOX = {
	description:
		"Show the user's storage LOCATIONS — the places their inventory is stored — as a grid of bins with " +
		'item counts. Use when they ask to see their locations/storage/where things are. Pass ' +
		'rename:{from,to} to RENAME a location or MERGE it into an existing one (all its items move to ' +
		'`to`). Pass remove:{name} to DELETE a location — its items stay, just without a place. For the ' +
		'items IN one location use data_crud list with {"field":"location","value":<name>}.',
	parameters: {
		type: 'object',
		properties: {
			rename: {
				type: 'object',
				description:
					'rename/merge: every item in location `from` moves to `to` (merging when `to` already exists).',
				properties: { from: { type: 'string' }, to: { type: 'string' } },
				required: ['from', 'to']
			},
			remove: {
				type: 'object',
				description: 'delete a location by name — its items stay, they just lose their place.',
				properties: { name: { type: 'string' } },
				required: ['name']
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

const NAME_PARAM = {
	name: { type: 'string', description: 'The mockup being promoted (kebab-case or plain words).' },
	response: { type: 'string', description: 'A short human-facing reply to show the user.' }
}
const PLAN_MAILBOX = {
	description:
		'STEP 1 of promoting a mockup to a real skill: derive + show the APP PLAN (entities from the ' +
		'example data, their fields, computed aggregates, seed counts). Use when the user says ' +
		'"skillify/promote the X mockup". The next step after the user agrees is mint_data.',
	parameters: { type: 'object', properties: NAME_PARAM, required: ['name'] }
}
const MINT_MAILBOX = {
	description:
		'STEP 2: mint the DATA layer for the app being promoted — Lojban predicates (reuse or mint via ' +
		'the Ontology engine) + the bundle + the derived CRUD ops. Run only after plan_app was agreed.',
	parameters: { type: 'object', properties: NAME_PARAM, required: ['name'] }
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// 1. restore the inventory actors (identity intact — only config was clobbered).
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(INV_CRUD_MAILBOX)}::jsonb, vibe = 'inventory',
			position = 1, updated_at = now()
		WHERE id = ${INV_DATA_CRUD}
	`.execute(db)
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(INV_LOCATIONS_MAILBOX)}::jsonb, vibe = 'inventory-locations',
			position = 2, updated_at = now()
		WHERE id = ${INV_LOCATIONS}
	`.execute(db)
	// 2. create the two step actors that never landed, under fresh unique ids.
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${PLAN_APP_ID}, 'skillify', 'plan_app', 'plan_app', ${JSON.stringify(PLAN_MAILBOX)}::jsonb, 'skill-plan', false, 10, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, position = 10, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${MINT_DATA_ID}, 'skillify', 'mint_data', 'mint_data', ${JSON.stringify(MINT_MAILBOX)}::jsonb, 'bundle-created', false, 11, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, position = 11, updated_at = now()
	`.execute(db)
}

export async function down(): Promise<void> {
	// forward-only repair.
}
