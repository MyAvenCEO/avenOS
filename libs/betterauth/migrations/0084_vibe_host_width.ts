import {
	cardStyle,
	goalsStyle,
	inventoryStyle,
	locationsStyle,
	todoStyle
} from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0112 — THE grid-layout root cause: the engine puts `container-type: inline-size` on the vibe :host
// (for container queries). On WebKit (Tauri/macOS) an auto-width host with inline-size containment SHRINKS
// TO FIT its content — so a grid child never gets a definite width and `auto-fill` collapsed to one column
// (todos looked fine only because its long rows made the shrink-wrap wide; the short goal/location cards
// made it narrow). brand-style now pins :host to width:100% of its definite parent. Re-seed every style
// whose vibe_style row baked the old :host, so the fix reaches the DB the client reads.

// the shared card style is seeded under many names (created/edited/deleted/ontology/query/mutation/bundle).
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

async function reseed(db: Kysely<unknown>, name: string, value: unknown): Promise<void> {
	await sql`
		INSERT INTO vibe_style (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await reseed(db, 'goals', goalsStyle)
	await reseed(db, 'inventory', inventoryStyle)
	await reseed(db, 'inventory-locations', locationsStyle)
	await reseed(db, 'todos', todoStyle)
	for (const name of CARD_STYLE_NAMES) await reseed(db, name, cardStyle)
}

export async function down(): Promise<void> {
	// non-destructive: re-run the prior style migrations to revert.
}
