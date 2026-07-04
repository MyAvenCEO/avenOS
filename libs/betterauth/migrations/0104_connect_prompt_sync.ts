import { type Kysely, sql } from 'kysely'

// board 0117 — the REAL sandbox async contract (the sequential-awaits rule of 0103 was still wrong):
// an asyncified host cap can only suspend the VM during the MAIN eval; a cap call inside a promise
// continuation (after ANY await) never settles. So connector code is PLAIN SYNCHRONOUS — caps.ops()
// blocks and returns directly (any number of calls). The prompt config learns the final rule; the
// smoke gate rejects async/await/Promise statically.

const PROMPT = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws. Read from the SOURCE, reconcile the TARGET per the USER RULE.',
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
	// re-run 0103 to restore the previous prompt.
}
