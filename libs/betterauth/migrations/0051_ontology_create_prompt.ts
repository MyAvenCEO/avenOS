import { CREATE_INSTRUCTIONS } from '@avenos/skills/tools'
import { type Kysely, sql } from 'kysely'

// board 0100 — make the ontology CREATE actor's real prompt visible in the Skills/Runs config aside.
// The mint runs on GLM-5.2 with CREATE_INSTRUCTIONS + the FULL gismu dictionary + the existing predicates;
// the gismu (~1 MB) is attached at runtime (too large to store on the node), so we put the instructions
// on the node's `system_prompt` with a note that the dictionary is appended. ActorConfig renders it.

const GISMU_NOTE =
	'\n\n— ATTACHED AT RUNTIME —\nThe FULL gismu dictionary (1300+ Lojban roots with their x1–x5 place ' +
	'structures, ~1 MB from .claude/skills/ontology/gismu.json) is appended to this system prompt as ' +
	'grounding, together with the current list of existing predicates (for the dedup gate). The create ' +
	'actor mints on GLM-5.2 over this whole context; `read` lists ALL predicates in the data_schema registry.'

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) {
		if (n.id === 'create') n.system_prompt = CREATE_INSTRUCTIONS + GISMU_NOTE
	}
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'ontology'`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) if (n.id === 'create') delete n.system_prompt
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'ontology'`.execute(db)
}
