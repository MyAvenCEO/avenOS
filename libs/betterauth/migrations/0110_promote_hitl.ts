import { type Kysely, sql } from 'kysely'

// board 0113/0117 — PROMOTE IS ALWAYS HITL (Samuel): going live (or overwriting a live design) shows
// a confirm card; aiConfirmAction executes after the human click. Config truth: the promote actor
// row + the skillify flow node carry hitl=true so the explorer shows the badge.

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET hitl = true, updated_at = now() WHERE skill_id = 'skillify' AND name = 'promote'`.execute(db)
	const flow = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'skillify'`.execute(db)
	if (!flow.rows.length) return
	const nodes = (typeof flow.rows[0].nodes === 'string' ? JSON.parse(flow.rows[0].nodes as string) : flow.rows[0].nodes) as Record<string, unknown>[]
	const n = nodes.find((x) => x.id === 'promote')
	if (n && !n.hitl) {
		n.hitl = true
		await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, updated_at = now() WHERE id = 'skillify'`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET hitl = false WHERE skill_id = 'skillify' AND name = 'promote'`.execute(db)
}
