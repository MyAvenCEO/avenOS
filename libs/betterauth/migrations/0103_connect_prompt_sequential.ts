import { type Kysely, sql } from 'kysely'

// board 0117 — the first live connect taught the author a sandbox fact: QuickJS asyncify suspends
// ONE host call at a time, so Promise.all / parallel awaits never settle ("actor did not settle").
// The connect_skills prompt (config SSOT) learns the SEQUENTIAL-awaits rule; 0102 already ran, so
// this is its own migration (never edit applied migrations).

const PROMPT = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  async function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws. Read from the SOURCE, reconcile the TARGET per the USER RULE.',
	'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
	'Idempotence matters: running the connector twice must not double-apply (match by name/label before',
	'creating; prefer update over create when a matching target row exists).',
	'SEQUENTIAL awaits ONLY: plain for-loops with await, one caps.ops call at a time. NEVER Promise.all,',
	'never parallel awaits, no async callbacks inside map/forEach — the sandbox suspends ONE host call',
	'at a time and parallel pending promises never settle.',
	'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
].join('\n')

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`UPDATE actor SET prompt = ${PROMPT}, updated_at = now() WHERE name = 'connect_skills'`.execute(db)
}

export async function down(): Promise<void> {
	// re-run 0102 to restore the previous prompt.
}
