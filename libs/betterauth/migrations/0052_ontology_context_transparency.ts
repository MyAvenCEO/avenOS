import { CREATE_INSTRUCTIONS } from '@avenos/skills/tools'
import { type Kysely, sql } from 'kysely'

// board 0100 — TRANSPARENT context: the Skills/Runs config aside (ActorConfig) renders the create node's
// `system_prompt`, so spell out EXACTLY what's in the create actor's context window at mint time — the
// attached gismu dictionary (now the compact TSV) + the live existing-predicate registry — so it's clear
// what grounds GLM-5.2. Updates the note added in 0051.

const CONTEXT_NOTE =
	'\n\n— ATTACHED CONTEXT (appended to THIS system prompt at mint time) —\n' +
	'1. THE GISMU DICTIONARY: all 1341 Lojban roots from `.claude/skills/ontology/gismu.tsv` (~130 KB), each ' +
	'line `word <tab> definition (with its x1…xN place structure in prose) <tab> keyword`. This grounds the ' +
	'choice of root + its FULL place structure. (Switched from the ~1 MB enriched gismu.json → ~8× smaller ' +
	'prompt, much faster mint.)\n' +
	'2. EXISTING PREDICATES: the current data_schema predicate registry (name + gloss, live from the DB) — ' +
	'the reuse/dedup gate so no near-duplicate relation is minted.\n' +
	'The create actor mints on GLM-5.2 over: these instructions + the dictionary + the existing predicates. ' +
	'`read` lists ALL predicates in the registry.'

function asJson(v: unknown): unknown {
	return typeof v === 'string' ? JSON.parse(v) : v
}

export async function up(db: Kysely<unknown>): Promise<void> {
	const res = await sql<{ nodes: unknown }>`SELECT nodes FROM flow WHERE id = 'ontology'`.execute(db)
	const row = res.rows[0]
	if (!row) return
	const nodes = asJson(row.nodes) as Array<Record<string, unknown>>
	for (const n of nodes) if (n.id === 'create') n.system_prompt = CREATE_INSTRUCTIONS + CONTEXT_NOTE
	await sql`UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb WHERE id = 'ontology'`.execute(db)
}

export async function down(_db: Kysely<unknown>): Promise<void> {
	// forward-only (0051 set the prior note).
}
