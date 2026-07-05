import { type Kysely, sql } from 'kysely'

// board 0117/0118 — the edit_skill actor (0109) gets its node on the explicit skillify flow, next
// to the other post-live seams (improve · sync · connect).

export async function up(db: Kysely<unknown>): Promise<void> {
	const flow = await sql<{ nodes: unknown; edges: unknown }>`
		SELECT nodes, edges FROM flow WHERE id = 'skillify'
	`.execute(db)
	if (!flow.rows.length) return
	const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>[]
	const nodes = parse(flow.rows[0].nodes)
	const edges = parse(flow.rows[0].edges)
	if (!nodes.some((n) => n.id === 'edit_skill')) {
		nodes.push({
			id: 'edit_skill',
			name: 'Edit meta',
			actor: 'edit_skill',
			inputs: ['app'],
			outputs: ['app'],
			note: 'Skill metadata: relabel + description — the id stays wire-stable.'
		})
		edges.push({ from: 'promote', to: 'edit_skill', kind: 'data' })
		await sql`
			UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, edges = ${JSON.stringify(edges)}::jsonb, updated_at = now()
			WHERE id = 'skillify'
		`.execute(db)
	}
}

export async function down(): Promise<void> {
	// node-only addition; safe to leave.
}
