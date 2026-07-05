import { goalsStyle } from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0114 — re-seed the goals vibe style with the LIVING @container example (the engine now puts
// inline-size containment on the view root, so container queries are a default vibe capability).

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO vibe_style (name, body) VALUES ('goals', ${JSON.stringify(goalsStyle)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function down(): Promise<void> {
	// non-destructive: re-run 0084 to revert.
}
