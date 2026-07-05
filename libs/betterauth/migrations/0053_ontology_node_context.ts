import { type Kysely, sql } from 'kysely'

// board 0100 — declare the ontology actors' ATTACHED CONTEXT generically (RecipeNode.context). The config
// UI (ActorConfig) resolves each `provider` through the universal /api/context/:provider endpoint and shows
// its ACTUAL content — so you can inspect the real gismu dictionary + the live predicate registry in the
// Skills/Runs aside. This is the generic mechanism (any actor can declare context), not an ontology special.

const CREATE_CONTEXT = [
	{
		label: 'Gismu dictionary (TSV)',
		provider: 'gismu',
		note: 'All 1341 Lojban roots — the compact gismu.tsv, grounding the mint (word · definition-with-place-structure · keyword).'
	},
	{ label: 'Existing predicates', provider: 'predicates', note: 'The live data_schema registry — the reuse/dedup gate.' }
]
const READ_CONTEXT = [
	{ label: 'Existing predicates', provider: 'predicates', note: 'The live data_schema predicate registry that read lists.' }
]

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.id === 'create') n.context = CREATE_CONTEXT
		if (n.id === 'read') n.context = READ_CONTEXT
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'ontology'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) delete n.context
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'ontology'`.execute(db)
}
