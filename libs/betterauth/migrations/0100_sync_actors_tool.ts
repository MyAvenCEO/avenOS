import { type Kysely, sql } from 'kysely'

// board 0116 (first slice, pulled forward by Samuel live) — `sync_actors`: the ADD-ONLY upgrade that
// brings a promoted skill to Planner-grade workflow granularity (per-step flow nodes read/create/
// edit/delete/overview + per-verb cards <type>-created/-edited). Advertised on skillify AND on every
// promoted skill (the improve_skill 0099 pattern), so either route carries the tool. The actual
// banking retrofit is NOT done here — Samuel triggers it from chat (the live demo of the seam).
// ID …0113d2 — globally unique (0095 lesson).

const ID = '00000000-0000-0000-0000-0000000113d2'

const MAILBOX = {
	description:
		'UPGRADE a promoted (live) skill to full workflow granularity: add the missing per-step flow ' +
		'nodes (read/create/edit/delete/overview) and their per-step cards (created/edited). ' +
		'ADD-ONLY — never rewrites existing pieces. Use when the user wants separate steps/cards ' +
		'for a live skill ("add a create-transaction step/view").',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The live skill (kebab-case or plain words).' },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['name']
	}
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
		VALUES (${ID}, 'skillify', 'sync_actors', 'sync_actors', ${JSON.stringify(MAILBOX)}::jsonb, false, 17, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, position = EXCLUDED.position, updated_at = now()
	`.execute(db)
	// per promoted skill (recognized by the <skill>_overview sandbox actor), like improve_skill 0099.
	const promoted = await sql<{ skill_id: string }>`
		SELECT skill_id FROM actor WHERE name = skill_id || '_overview' AND code IS NOT NULL
	`.execute(db)
	for (const row of promoted.rows) {
		await sql`
			INSERT INTO actor (id, skill_id, name, engine, mailbox, hitl, position, created_at, updated_at)
			SELECT gen_random_uuid(), ${row.skill_id}, 'sync_actors', 'sync_actors', ${JSON.stringify(MAILBOX)}::jsonb, false, 4, now(), now()
			WHERE NOT EXISTS (SELECT 1 FROM actor WHERE skill_id = ${row.skill_id} AND name = 'sync_actors')
		`.execute(db)
	}
	// the skillify explicit flow gets the Sync node next to Improve.
	const flow = await sql<{ nodes: unknown; edges: unknown }>`
		SELECT nodes, edges FROM flow WHERE id = 'skillify'
	`.execute(db)
	if (!flow.rows.length) return
	const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>[]
	const nodes = parse(flow.rows[0].nodes)
	const edges = parse(flow.rows[0].edges)
	if (!nodes.some((n) => n.id === 'sync_actors')) {
		nodes.push({
			id: 'sync_actors',
			name: 'Sync steps',
			actor: 'sync_actors',
			inputs: ['app'],
			outputs: ['app'],
			note: 'Add-only upgrade: missing per-step flow nodes + per-verb cards for a live skill.'
		})
		edges.push({ from: 'promote', to: 'sync_actors', kind: 'data' })
		await sql`
			UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, edges = ${JSON.stringify(edges)}::jsonb, updated_at = now()
			WHERE id = 'skillify'
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ID}`.execute(db)
	await sql`DELETE FROM actor WHERE name = 'sync_actors' AND skill_id != 'skillify'`.execute(db)
}
