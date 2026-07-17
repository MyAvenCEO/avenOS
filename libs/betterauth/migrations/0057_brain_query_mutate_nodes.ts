import { type Kysely, sql } from 'kysely'

// board 0101 — add two more actors to the Brain skill hub: `query` (GLM authors a validated filter/join/count
// spec over the x1–x5 store and runs it) and `mutate` (GLM authors a validated insert/delete transaction;
// destructive ops are HITL-gated). Each declares its ATTACHED CONTEXT generically (RecipeNode.context) so the
// Skills/Runs aside shows the ACTUAL grounding: the live predicate registry + the stored specs it can reuse.

const PREDICATES_CTX = {
	label: 'Existing predicates',
	provider: 'predicates',
	note: 'The live data_schema place-structures — GLM picks `from`/`predicate` + places from these.'
}
const QUERY_NODE = {
	id: 'query',
	name: 'Query data',
	actor: 'brain',
	inputs: ['intent'],
	outputs: ['rows'],
	vibe: 'query-result',
	note: 'query — GLM authors a validated filter/join/count spec over the x1–x5 store → runs it → rows.',
	context: [
		PREDICATES_CTX,
		{
			label: 'Stored queries',
			provider: 'data_queries',
			note: 'The data_queries registry — every authored query spec.'
		}
	]
}
const MUTATE_NODE = {
	id: 'mutate',
	name: 'Mutate data',
	actor: 'brain',
	inputs: ['intent'],
	outputs: ['ops'],
	vibe: 'mutation-result',
	note: 'mutate — GLM authors a validated insert/delete transaction; a destructive op is HITL-confirmed first.',
	context: [
		PREDICATES_CTX,
		{
			label: 'Stored mutations',
			provider: 'data_mutations',
			note: 'The data_mutations registry — every authored mutation spec.'
		}
	]
}

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown; resource_labels: unknown }>`
		SELECT nodes, resource_labels FROM flow WHERE id = 'brain'
	`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	const byId = new Set(nodes.map((n) => n.id))
	if (!byId.has('query')) nodes.push(QUERY_NODE)
	if (!byId.has('mutate')) nodes.push(MUTATE_NODE)
	const labels = {
		...(asJson(row.resource_labels) as Record<string, string>),
		rows: 'Rows',
		ops: 'Ops'
	}
	await sql`
		UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, resource_labels = ${JSON.stringify(labels)}::jsonb, updated_at = now()
		WHERE id = 'brain'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'brain'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = (asJson(row.nodes) as Array<Record<string, unknown>>).filter(
		(n) => n.id !== 'query' && n.id !== 'mutate'
	)
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'brain'`.execute(db)
}
