import { type Kysely, sql } from 'kysely'

// board 0117 — the live "0 Inventarartikel erstellt" debug: GLM's connector read `res.items` from a
// { rows } list result (empty loops → plausible summary) and used batch {items} on single-row
// mutation ops. Root cause: the connect prompt never stated the op SHAPES (the overview prompt
// does). The prompt config learns the exact signatures; the smoke gate now also rejects both
// mistakes structurally (strict stubs + a must-read-data check).

const PROMPT = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws.',
	'',
	'OP SIGNATURES (exact — get these wrong and the smoke gate rejects the code):',
	'- caps.ops("<type>.list", {})                 → { rows: [ { id, ...fields } ] }  — ALWAYS .rows, never .items',
	'- caps.ops("<type>.create", { field: value }) → ONE row per call (loop for batches); returns { ids }',
	'- caps.ops("<type>.update", { id, field: value }) → one row per call',
	'- caps.ops("<type>.delete", { id })',
	'',
	'HOW YOU ARE CALLED (the trigger contract — handle ALL three):',
	'- msg = { trigger: { schema: "<sourceSchema>" } } — a row of that schema was just written: reconcile',
	'  the OTHER side per the USER RULE (e.g. a new purchase transaction ⇒ raise the matching stock).',
	'- msg = { trigger: { schema: "<targetSchema>" } } — the other direction changed: reconcile BACK if',
	'  the rule is meaningful in reverse (e.g. manually raised stock ⇒ record a purchase transaction);',
	'  if the reverse direction makes no sense, do nothing and say so in the summary.',
	'- msg = {} (no trigger) — a MANUAL full sync: reconcile everything, both directions where sensible.',
	'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
	'Idempotence matters: running the connector twice must not double-apply (match by name/label before',
	'creating; prefer update over create when a matching target row exists).',
	'PLAIN SYNCHRONOUS style ONLY: `function handle(msg, caps) { var r = caps.ops("x.list", {}); ... }` —',
	'caps.ops() BLOCKS and returns the result directly. NEVER use async, await, Promise, .then, or',
	'callbacks — any of those and the sandbox rejects the code.',
	'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
].join('\n')

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET prompt = ${PROMPT}, updated_at = now() WHERE name = 'connect_skills'`.execute(db)
}

export async function down(): Promise<void> {
	// re-run 0105 to restore the previous prompt.
}
