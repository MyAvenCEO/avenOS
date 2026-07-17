import { type Kysely, sql } from 'kysely'
import { MOCKUP_INSTRUCTIONS } from '../src/mockup-caps'

// board 0115 — split the single `mockup` actor into CREATE vs EDIT (Samuel: distinct actors per intent).
// One tool doing both silently minted a NEW mockup whenever the model forgot `name` on a refinement;
// edit_mockup now REQUIRES the name (fuzzy-resolved, honest not-found). Both carry the authoring prompt
// as config; both stream GLM tokens live. `mockups` (show/list) stays. Skillify is hours old — no
// wire-stability concern.

const CREATE_ID = '00000000-0000-0000-0000-0000000115a1' // reuses the old mockup row id (renamed)
const EDIT_ID = '00000000-0000-0000-0000-0000000115a3'

const CREATE_MAILBOX = {
	description:
		'DESIGN a NEW screen mockup for a skill feature (look only — view, style, example data; no real ' +
		'data). Use when the user wants to design/mock/sketch a screen that does not exist yet. To change ' +
		'an existing mockup use edit_mockup; to just display one use mockups.',
	parameters: {
		type: 'object',
		properties: {
			description: {
				type: 'string',
				description:
					'What the screen should show, in the user\'s words (e.g. "banking accounts with balances and a total").'
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['description']
	}
}
const EDIT_MAILBOX = {
	description:
		'REFINE an existing screen mockup ("make the total bigger", "add a progress bar"). Requires the ' +
		'mockup `name` — never creates a new one. To design from scratch use create_mockup.',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'Which mockup to change (kebab-case or plain words).' },
			description: { type: 'string', description: "The change to apply, in the user's words." },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['name', 'description']
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	// the old combined `mockup` row becomes create_mockup (same id → clean upsert).
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, prompt, hitl, position, created_at, updated_at)
		VALUES (${CREATE_ID}, 'skillify', 'create_mockup', 'create_mockup', ${JSON.stringify(CREATE_MAILBOX)}::jsonb, ${MOCKUP_INSTRUCTIONS}, false, 1, now(), now())
		ON CONFLICT (id) DO UPDATE SET name = 'create_mockup', engine = 'create_mockup',
			mailbox = EXCLUDED.mailbox, prompt = EXCLUDED.prompt, position = 1, updated_at = now()
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, prompt, hitl, position, created_at, updated_at)
		VALUES (${EDIT_ID}, 'skillify', 'edit_mockup', 'edit_mockup', ${JSON.stringify(EDIT_MAILBOX)}::jsonb, ${MOCKUP_INSTRUCTIONS}, false, 2, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, prompt = EXCLUDED.prompt, updated_at = now()
	`.execute(db)
	await sql`UPDATE actor SET position = 3, updated_at = now() WHERE skill_id = 'skillify' AND name = 'mockups'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${EDIT_ID}`.execute(db)
	await sql`
		UPDATE actor SET name = 'mockup', engine = 'mockup', updated_at = now() WHERE id = ${CREATE_ID}
	`.execute(db)
}
