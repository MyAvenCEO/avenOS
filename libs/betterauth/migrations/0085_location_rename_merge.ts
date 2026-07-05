import { randomUUID } from 'node:crypto'
import { type Kysely, sql } from 'kysely'

// board 0112 — LIVE FINDING: "rename Keller to cellar" had no tool — the model fake-updated inventory
// instead. Mirror the goals lifecycle onto locations (entities since 0081): two universal mutations
// (repoint / dissolve the located edges by entity id) + rename/remove on the locations actor mailbox.

const RENAME_OP = {
	name: 'inventory.location-rename',
	params: ['from', 'to'],
	ops: [
		{
			op: 'update',
			predicate: 'located',
			where: [{ place: 'x2', op: 'eq', param: 'from' }],
			cells: { x2: { param: 'to' } }
		}
	]
}
const CLEAR_OP = {
	name: 'inventory.location-clear',
	params: ['location'],
	ops: [
		{
			op: 'delete',
			predicate: 'located',
			where: [{ place: 'x2', op: 'eq', param: 'location' }]
		}
	]
}

const MAILBOX = {
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

export async function up(db: Kysely<unknown>): Promise<void> {
	for (const op of [RENAME_OP, CLEAR_OP]) {
		await sql`DELETE FROM data_operations WHERE name = ${op.name} AND user_id IS NULL`.execute(db)
		await sql`
			INSERT INTO data_operations (id, user_id, name, kind, spec, created_at, updated_at)
			VALUES (${randomUUID()}, NULL, ${op.name}, 'mutation', ${JSON.stringify(op)}::jsonb, now(), now())
		`.execute(db)
	}
	await sql`
		UPDATE actor SET mailbox = ${JSON.stringify(MAILBOX)}::jsonb, updated_at = now()
		WHERE skill_id = 'inventory' AND name = 'locations'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM data_operations WHERE name IN ('inventory.location-rename', 'inventory.location-clear') AND user_id IS NULL`.execute(db)
}
