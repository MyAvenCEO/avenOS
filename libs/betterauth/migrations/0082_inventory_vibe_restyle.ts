import {
	inventoryLogic,
	inventoryStyle,
	inventoryView,
	locationsLogic,
	locationsStyle,
	locationsView
} from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — give the Inventory its OWN look. Until now the inventory list borrowed the todos card style
// and the locations grid borrowed the goals grid style. This re-seeds both from bespoke SSOT (an ochre
// "stock ledger" list with quantity badges + a "storage bins" locations grid), and adds a `locations`
// actor to the inventory skill so the locations grid is actually reachable in chat ("show my locations").

const ACTOR_ID = '00000000-0000-0000-0000-0000000113b2'
const LOCATIONS_MAILBOX = {
	description:
		"Show the user's storage LOCATIONS — the places their inventory is stored — as a grid of bins with " +
		'item counts. Use when they ask to see their locations/storage/where things are. For the items IN ' +
		'one location use data_crud list with {"field":"location","value":<name>}.',
	parameters: {
		type: 'object',
		properties: {
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}

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
	// 1. the bespoke inventory list ("stock ledger") + locations grid ("storage bins").
	await upsertJson(db, 'vibe_view', 'inventory', inventoryView)
	await upsertJson(db, 'vibe_style', 'inventory', inventoryStyle)
	await upsertLogic(db, 'inventory', inventoryLogic)
	await upsertJson(db, 'vibe_view', 'inventory-locations', locationsView)
	await upsertJson(db, 'vibe_style', 'inventory-locations', locationsStyle)
	await upsertLogic(db, 'inventory-locations', locationsLogic)

	// 2. the `locations` actor — makes the locations grid chat-reachable (same generic ops handler).
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, vibe, hitl, position, created_at, updated_at)
		VALUES (${ACTOR_ID}, 'inventory', 'locations', 'locations', ${JSON.stringify(LOCATIONS_MAILBOX)}::jsonb, 'inventory-locations', false, 2, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, vibe = EXCLUDED.vibe, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ACTOR_ID}`.execute(db)
	// view/style/logic revert = re-running 0080.
}
