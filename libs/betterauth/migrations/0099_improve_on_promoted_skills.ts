import { type Kysely, sql } from 'kysely'

// board 0113 — every promoted skill is SELF-IMPROVABLE: wireSkill now mints an improve_skill actor on
// the new skill itself (so "improve the banking skill: …" works when the router correctly lands on the
// skill, not on skillify). This migration retrofits the actor onto skills promoted BEFORE that change —
// recognized by their `<skill>_overview` sandbox-code actor (the promoted-app signature). Live trigger:
// Samuel's "improve the banking skill" routed to banking-overview, which had no improve tool, and gemma
// answered "I don't have the ability". Self-contained copy of improveMailboxFor (migrations never
// import src).

export async function up(db: Kysely<unknown>): Promise<void> {
	const promoted = await sql<{ skill_id: string; label: string | null }>`
		SELECT a.skill_id, s.label
		FROM actor a JOIN skill s ON s.id = a.skill_id
		WHERE a.name = a.skill_id || '_overview' AND a.code IS NOT NULL
	`.execute(db)
	for (const row of promoted.rows) {
		const skillId = row.skill_id
		const label = row.label ?? skillId.replace(/-/g, ' ')
		const mailbox = {
			description:
				`IMPROVE the ${label} skill itself: bake a user rule into how entries are interpreted — number ` +
				'formats ("German 25,33 €"), sign conventions ("bought/purchase = negative"), defaults, wording. ' +
				'Use when the user asks to improve/change/teach THIS skill (not for adding data).',
			parameters: {
				type: 'object',
				properties: {
					name: { type: 'string', description: `Always "${skillId}" on this skill.` },
					instruction: { type: 'string', description: "The rule to bake in, in the user's words." },
					response: { type: 'string', description: 'A short human-facing reply to show the user.' }
				},
				required: ['name', 'instruction']
			}
		}
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
			SELECT gen_random_uuid(), ${skillId}, 'improve_skill', 'improve_skill', ${JSON.stringify(mailbox)}::jsonb, false, 3, now(), now()
			WHERE NOT EXISTS (SELECT 1 FROM actor WHERE skill_id = ${skillId} AND name = 'improve_skill')
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`
		DELETE FROM actor WHERE name = 'improve_skill' AND skill_id IN (
			SELECT skill_id FROM actor WHERE name = skill_id || '_overview' AND code IS NOT NULL
		)
	`.execute(db)
}
