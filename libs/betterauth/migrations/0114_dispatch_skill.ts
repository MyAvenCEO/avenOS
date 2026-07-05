import { type Kysely, sql } from 'kysely'

// board 0119q — NO HARDCODED PROMPTS: the dispatcher becomes a real skill with actor rows, so every
// LLM roundtrip's prompt is DB config (editable, transparent in the Flows aside). The TS strings in
// skills/tools/dispatch.ts + the client SYSTEM_PROMPT remain only as seed/fail-safe fallbacks.
// - skill `dispatch` (manifest {"system": true} → excluded from its own router menu, never routable)
// - actor `dispatch` — the Tier-1 router scaffold prompt ({menu} is replaced with the live skill menu)
// - actor `chat` — the base system prompt of the main chat turn (server-enforced over the client seed)
// - skill.manifest gains hint config: `hint_providers` (context providers resolved live per turn) +
//   `hint_static` (a fixed text block) — replaces the hardcoded per-skill branches in ai.ts.
// Literals are INLINED (a migration must never import runtime engine code — the 0073 outage lesson).

const ROUTER_SCAFFOLD =
	'You are a router. Reply with EXACTLY ONE skill id from this list — just the id, lowercase, no ' +
	'punctuation, no explanation:\n{menu}' +
	'\nIf the user message continues an ongoing task visible in the recent conversation (e.g. ' +
	'"weiter", "nochmal", "continue", "next step", a bare confirmation), pick the skill of THAT task.' +
	'\nRequests about a skill/app ITSELF — creating, improving, redesigning it, changing its rules or ' +
	'behavior — belong to skillify. Requests about the DATA INSIDE a skill belong to that skill.'

const CHAT_BASE_PROMPT =
	'You are a helpful assistant inside the avenOS Alberobello chat. Be concise and friendly. ' +
	'To show the user their website (read-only), call show_website. To change their website, call ' +
	'edit_website with a clear instruction — a specialist model does the rewrite, so you never ' +
	'write HTML yourself. To PUBLISH their website to the live web (www.next.aven.ceo), call ' +
	'deploy_website — the user must confirm a publish prompt and only an admin can deploy; you never ' +
	'upload anything yourself.'

const SKILLIFY_SEAMS = [
	'UPDATE SEAMS — pick by WHAT the user wants to change:',
	'· behavior/rules/formats → improve_skill. Batch ops are BUILT-IN (create/update items[], delete ids[]) — answer capability questions directly, do not call a tool.',
	'· missing workflow steps/cards (UI granularity) → sync_actors (add-only).',
	'· look/design → edit_mockup on the mock, then promote to push live.',
	'· keep two skills in sync → connect_skills.'
].join('\n')

const FLOW_NODES = [
	{
		id: 'route',
		name: 'Dispatch',
		note: 'Tier-1 router — the schema-free roundtrip that picks ONE skill per turn.',
		actor: 'dispatch',
		inputs: ['intent'],
		outputs: ['skill']
	},
	{
		id: 'chat',
		name: 'Chat turn',
		note: 'The main LLM roundtrip — base system prompt + the routed skill\'s live hint + its advertised tools.',
		actor: 'chat',
		inputs: ['skill'],
		outputs: ['reply']
	}
]
const FLOW_EDGES = [{ from: 'route', to: 'chat', kind: 'control' }]

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO skill (id, label, description, manifest, position)
		VALUES (
			'dispatch', 'Dispatch',
			'SYSTEM — routes each request (with recent turns) to exactly ONE skill, then runs the chat turn with only that skill''s tools.',
			'{"system": true}'::jsonb, 0
		)
		ON CONFLICT (id) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, prompt, context, position)
		VALUES ('dispatch', 'dispatch', 'dispatch', 'dispatch', ${ROUTER_SCAFFOLD}, '["dispatch_prompt"]'::jsonb, 0)
		ON CONFLICT (id) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, prompt, position)
		VALUES ('chat', 'dispatch', 'chat', 'chat', ${CHAT_BASE_PROMPT}, 1)
		ON CONFLICT (id) DO NOTHING
	`.execute(db)
	await sql`
		INSERT INTO flow (id, name, description, nodes, edges)
		VALUES (
			'dispatch', 'Dispatch',
			'The system pipeline behind every turn — route to one skill, then run the chat roundtrip with its tools.',
			${JSON.stringify(FLOW_NODES)}::jsonb, ${JSON.stringify(FLOW_EDGES)}::jsonb
		)
		ON CONFLICT (id) DO NOTHING
	`.execute(db)
	// hint config replaces the hardcoded per-skill branches in ai.ts (todos snapshot / skillify seams).
	await sql`
		UPDATE skill SET manifest = COALESCE(manifest, '{}'::jsonb) || ${JSON.stringify({ hint_providers: ['todos_snapshot'] })}::jsonb,
			updated_at = now() WHERE id = 'todos'
	`.execute(db)
	await sql`
		UPDATE skill SET manifest = COALESCE(manifest, '{}'::jsonb) || ${JSON.stringify({ hint_providers: ['promotion_status'], hint_static: SKILLIFY_SEAMS })}::jsonb,
			updated_at = now() WHERE id = 'skillify'
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM flow WHERE id = 'dispatch'`.execute(db)
	await sql`DELETE FROM actor WHERE skill_id = 'dispatch'`.execute(db)
	await sql`DELETE FROM skill WHERE id = 'dispatch'`.execute(db)
	await sql`
		UPDATE skill SET manifest = manifest - 'hint_providers' - 'hint_static', updated_at = now()
		WHERE id IN ('todos', 'skillify')
	`.execute(db)
}
