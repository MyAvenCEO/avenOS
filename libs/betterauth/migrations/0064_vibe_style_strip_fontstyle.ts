import { type Kysely, sql } from 'kysely'

// board 0105 — the aven-ui style-validator enforces a CSS-property ALLOW-LIST (a security boundary: only
// vetted properties may reach the renderer). `fontStyle` is not on it, so the 0063-seeded card styles were
// rejected at mount. Strip `fontStyle` from every vibe_style's `.vc-request` selector on existing DBs
// (0063's source is also corrected for fresh replays). We fix the DATA to obey the allow-list — we never
// widen the list.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE vibe_style
		SET body = body #- '{selectors,.vc-request,fontStyle}', updated_at = now()
		WHERE body #> '{selectors,.vc-request,fontStyle}' IS NOT NULL
	`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (re-adding a forbidden property would just fail validation again).
}
