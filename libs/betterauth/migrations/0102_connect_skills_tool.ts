import { type Kysely, sql } from 'kysely'

// board 0117 — `connect_skills` on skillify: the cross-skill CONNECTOR seam (composite sub-skill
// pattern — skills stack recursively via flowRef nodes, the board-0083 seat). GLM authors ONLY the
// connector's sandbox code (this prompt row is its instructions, ENGINE FACTS included); the server
// scopes caps to exactly the two schemas and smoke-gates before anything lands. ID …0113d3.

const ID = '00000000-0000-0000-0000-0000000113d3'

const MAILBOX = {
	description:
		'CONNECT two live skills (the sub-skill/composite pattern): e.g. "every banking purchase updates ' +
		'the inventory". Authors a sandboxed connector on the SOURCE skill (caps scoped to both ' +
		'schemas, smoke-gated) + a sub-skill flow node. Pass name (source), target, instruction (the rule).',
	parameters: {
		type: 'object',
		properties: {
			name: { type: 'string', description: 'The SOURCE skill that feeds the sync (kebab-case or plain words).' },
			target: { type: 'string', description: 'The TARGET skill to keep in sync (kebab-case or plain words).' },
			instruction: { type: 'string', description: "The sync rule, in the user's words." },
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		},
		required: ['name', 'target', 'instruction']
	}
}

const PROMPT = [
	'You write a CONNECTOR between two apps as a SINGLE JavaScript module for a locked-down sandbox:',
	'  async function handle(msg, caps) { ... return state }',
	'caps.ops(name, params) is the ONLY capability — and it is SCOPED to exactly the two schemas below;',
	'calling any other op throws. Read from the SOURCE, reconcile the TARGET per the USER RULE.',
	'RETURN a state object with at least { "summary": "<one German sentence: what was synced/changed>" }.',
	'Idempotence matters: running the connector twice must not double-apply (match by name/label before',
	'creating; prefer update over create when a matching target row exists).',
	'No imports, no fetch, no timers, no globals — plain ES5-ish JS + JSON/Math. Output ONLY the code.'
].join('\n')

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, prompt, hitl, position, created_at, updated_at)
		VALUES (${ID}, 'skillify', 'connect_skills', 'connect_skills', ${JSON.stringify(MAILBOX)}::jsonb, ${PROMPT}, false, 18, now(), now())
		ON CONFLICT (id) DO UPDATE SET mailbox = EXCLUDED.mailbox, prompt = EXCLUDED.prompt, position = EXCLUDED.position, updated_at = now()
	`.execute(db)
	// the skillify explicit flow gets the Connect node next to Sync steps.
	const flow = await sql<{ nodes: unknown; edges: unknown }>`
		SELECT nodes, edges FROM flow WHERE id = 'skillify'
	`.execute(db)
	if (!flow.rows.length) return
	const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown>[]
	const nodes = parse(flow.rows[0].nodes)
	const edges = parse(flow.rows[0].edges)
	if (!nodes.some((n) => n.id === 'connect_skills')) {
		nodes.push({
			id: 'connect_skills',
			name: 'Connect',
			actor: 'connect_skills',
			inputs: ['app'],
			outputs: ['app'],
			note: 'Cross-skill connector: scoped sandbox actor on the source + a composite flowRef node to the target skill.'
		})
		edges.push({ from: 'promote', to: 'connect_skills', kind: 'data' })
		await sql`
			UPDATE flow SET nodes = ${JSON.stringify(nodes)}::jsonb, edges = ${JSON.stringify(edges)}::jsonb, updated_at = now()
			WHERE id = 'skillify'
		`.execute(db)
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ID}`.execute(db)
}
