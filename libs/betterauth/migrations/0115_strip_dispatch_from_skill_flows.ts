import { type Kysely, sql } from 'kysely'

// board 0119r — CLEAN SEPARATION OF CONCERNS: the dispatcher ROUTES a turn to one skill (it lives in
// its own system skill flow, migration 0114); the skill EXECUTES. Skill flows therefore carry only
// their actual steps — the embedded `dispatch` node + its star-edges (pre-0114 leftovers) are
// stripped from every flow except the dispatch flow itself. Pure data transformation, no runtime
// imports (the 0073 lesson).

type Node = { id: string; actor?: string } & Record<string, unknown>
type Edge = { from: string; to: string } & Record<string, unknown>

export async function up(db: Kysely<unknown>): Promise<void> {
	const rows = await sql<{ id: string; nodes: unknown; edges: unknown }>`
		SELECT id, nodes, edges FROM flow WHERE id <> 'dispatch'
	`.execute(db)
	const parse = <T>(v: unknown): T[] =>
		Array.isArray(v) ? (v as T[]) : typeof v === 'string' ? (JSON.parse(v) as T[]) : []
	for (const row of rows.rows) {
		const nodes = parse<Node>(row.nodes)
		const edges = parse<Edge>(row.edges)
		const dispatchIds = new Set(
			nodes.filter((n) => n.id === 'dispatch' || n.actor === 'dispatch').map((n) => n.id)
		)
		if (dispatchIds.size === 0) continue
		const keptNodes = nodes.filter((n) => !dispatchIds.has(n.id))
		const keptEdges = edges.filter((e) => !dispatchIds.has(e.from) && !dispatchIds.has(e.to))
		await sql`
			UPDATE flow SET nodes = ${JSON.stringify(keptNodes)}::jsonb,
				edges = ${JSON.stringify(keptEdges)}::jsonb, updated_at = now()
			WHERE id = ${row.id}
		`.execute(db)
	}
}

export async function down(): Promise<void> {
	// no restore — the embedded dispatch nodes were pre-0114 leftovers, not config to bring back.
}
