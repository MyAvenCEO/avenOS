import { goalsStyle, inventoryStyle, locationsStyle } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — two live fixes:
//  1. GRID LAYOUT: the goals/inventory/locations grid roots lacked an explicit width, so the flex column
//     shrink-wrapped and `auto-fill` collapsed to a single column. The SSOT styles now set width:100% on the
//     roots + grids; re-seed the three vibe_style rows.
//  2. MOVE: teach the inventory data_crud mailbox that MOVING an item = update it with a new `location`
//     (a place name), and that an item can be referenced by name — the actor resolves it to the row id.

const INVENTORY_ITEMS_DESC =
	'create: {"name":"Hammer","location":"Garage","amount":"3"}. To MOVE an item, update it with a new ' +
	'"location" (a place name — a new place is created automatically). To restock, update its "amount". ' +
	'update: the fields to change + the item\'s "id" (or its name — it is resolved to the row).'

async function reseedStyle(db: Kysely<unknown>, name: string, value: unknown): Promise<void> {
	await sql`
		INSERT INTO vibe_style (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await reseedStyle(db, 'goals', goalsStyle)
	await reseedStyle(db, 'inventory', inventoryStyle)
	await reseedStyle(db, 'inventory-locations', locationsStyle)
	await sql`
		UPDATE actor SET mailbox = jsonb_set(
			mailbox, '{parameters,properties,items,description}', to_jsonb(${INVENTORY_ITEMS_DESC}::text)
		), updated_at = now()
		WHERE skill_id = 'inventory' AND name = 'data_crud'
	`.execute(db)
}

export async function down(): Promise<void> {
	// style revert = re-run 0077/0082; mailbox revert = re-run 0080. No destructive change here.
}
