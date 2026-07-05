import { type Kysely, sql } from 'kysely'

// board 0117 — the connector author learns the FULL trigger contract (Samuel: "it should be
// bi-directional" + "we need a more detailed prompt"): the trigger seam already fires from EITHER
// schema (caps subscribe both sides), so the code must branch on msg.trigger.schema — forward
// reconcile, reverse reconcile (or an honest no-op), and manual full sync. The contracts fed to GLM
// now also carry each skill's own data rules (the crud descriptions, incl. improve_skill-earned
// wording), and the smoke gate runs all three call paths.

const PROMPT = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws.',
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
	// re-run 0104 to restore the previous prompt.
}
