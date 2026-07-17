import { type Kysely, sql } from 'kysely'

// board 0113 — the POST-LIVE loop: `improve_skill` on skillify. A promoted skill's behavior lives in
// config (the data_crud actor's mailbox wording), so improving it IS a config edit: GLM rewrites the
// wording to bake a user rule in ("German number format 25,33 €", "bought/purchase ⇒ negative"),
// fail-closed grafted server-side (description texts only — the parameter schema shape is never
// GLM-writable). Live trigger: Samuel asked exactly this and gemma, lacking the tool, hallucinated
// edit_website (blocked by the advertised-set gate). ID …0113d1 — globally unique (0095 lesson).

const ID = '00000000-0000-0000-0000-0000000113d1'

const MAILBOX = {
	description:
		'IMPROVE a promoted (live) skill: bake a user rule into its data behavior — number formats ' +
		'("German 25,33 €"), sign conventions ("bought/purchase = negative"), defaults, wording. ' +
		'Pass the skill name + the rule. Only for LIVE skills — mockup looks change via edit_mockup.',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The live skill (kebab-case or plain words).' },
			instruction: { type: 'string', description: "The rule to bake in, in the user's words." },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['name', 'instruction']
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
		VALUES (${ID}, 'skillify', 'improve_skill', 'improve_skill', ${JSON.stringify(MAILBOX)}::jsonb, false, 16, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, position = EXCLUDED.position, updated_at = now()
	`.execute(db)
	// extend the explicit skillify flow: the post-live improvement loop hangs off `promote`.
	const flow = await sql<{ nodes: unknown; edges: unknown }>`
		SELECT nodes, edges FROM flow WHERE id = 'skillify'
	`.execute(db)
	if (!flow.rows.length) return
	const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>[]
	const nodes = parse(flow.rows[0].nodes)
	const edges = parse(flow.rows[0].edges)
	if (!nodes.some((n) => n.id === 'improve_skill')) {
		nodes.push({
			id: 'improve_skill',
			name: 'Improve',
			actor: 'improve_skill',
			inputs: ['app'],
			outputs: ['app'],
			note: 'Post-live loop: GLM rewrites the data_crud mailbox wording (fail-closed graft) to bake user rules in.'
		})
		edges.push({ from: 'promote', to: 'improve_skill', kind: 'data' })
		await sql`
			UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, edges = ${JSON.stringify(edges)}::jsonb, updated_at = now()
			WHERE id = 'skillify'
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ID}`.execute(db)
}
