import { type Kysely, sql } from 'kysely'

// board 0117/0118 — `edit_skill`: skill METADATA editing from chat ("rename the skill" = relabel;
// the id is WIRE-STABLE and never renamed — the 0040 lesson). Advertised on skillify AND every
// promoted skill (the improve_skill pattern). Also part of the promotion-reliability fix: the
// derived progress now detects DESIGN DRIFT (edited mockup vs live vibes) and re-opens `promote`
// as the next step, so "edit then promote to production" works end to end. ID …0113d5.

const ID = '00000000-0000-0000-0000-0000000113d5'

const MAILBOX = {
	description:
		'EDIT a skill’s METADATA: the display label ("rename" — the internal id stays stable so ' +
		'nothing breaks) and/or the description (what the router reads). Deterministic, instant. ' +
		'For behavior rules use improve_skill; for the look use edit_mockup.',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The skill (kebab-case or plain words). Id never changes.' },
			label: { type: 'string', description: 'The new display name.' },
			description: { type: 'string', description: 'The new skill description (router-facing).' },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['name']
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
		VALUES (${ID}, 'skillify', 'edit_skill', 'edit_skill', ${JSON.stringify(MAILBOX)}::jsonb, false, 19, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, position = EXCLUDED.position, updated_at = now()
	`.execute(db)
	const promoted = await sql<{ skill_id: string }>`
		SELECT skill_id FROM actor WHERE name = skill_id || '_overview' AND code IS NOT NULL
	`.execute(db)
	for (const row of promoted.rows) {
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
			SELECT gen_random_uuid(), ${row.skill_id}, 'edit_skill', 'edit_skill', ${JSON.stringify(MAILBOX)}::jsonb, false, 6, now(), now()
			WHERE NOT EXISTS (SELECT 1 FROM actor WHERE skill_id = ${row.skill_id} AND name = 'edit_skill')
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ID}`.execute(db)
	await sql`DELETE FROM actor WHERE name = 'edit_skill' AND skill_id != 'skillify'`.execute(db)
}
