import { type Kysely, sql } from 'kysely'
import { EDIT_INSTRUCTIONS, MOCKUP_INSTRUCTIONS } from '../src/mockup-caps'

// board 0115 — two authoring upgrades as config:
//  · edit_mockup gets its OWN prompt: a MINIMAL PATCH (only changed sections, deep-merged server-side)
//    instead of a full rewrite — untouched parts preserved by construction.
//  · create_mockup's prompt gains the inline-SVG ICON subset (shape tags + geometry/paint attrs only,
//    gated in the view validator) — the "category icons" ask no longer needs a refusal.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		UPDATE actor SET prompt = ${MOCKUP_INSTRUCTIONS}, updated_at = now()
		WHERE skill_id = 'skillify' AND name = 'create_mockup'
	`.execute(db)
	await sql`
		UPDATE actor SET prompt = ${EDIT_INSTRUCTIONS}, updated_at = now()
		WHERE skill_id = 'skillify' AND name = 'edit_mockup'
	`.execute(db)
}

export async function down(): Promise<void> {
	// re-run 0092 to restore the shared prompt.
}
