import { type Kysely, sql } from 'kysely'

// board 0107 — give the Todos skill the SAME generic `query` actor the Ontology skill already has, so
// filtered / joined / counted reads ("show me done todos", "todos due this week", "how many are open") are
// answered by GLM authoring a VALIDATED QuerySpec over the x1–x5 store (join-targeted filters + null ops),
// never by any hardcoded filter vocabulary. A plain "show me my todos" still routes to data_crud; a request
// that needs a filter/join/count routes to query — the two tool descriptions draw that line for the model.
// Config-as-data: one actor row (engine-by-name 'query' → skills/tools/queries.ts), no code path change.

const ID = '00000000-0000-0000-0000-0000000107a1'
const MAILBOX = {
	description:
		"Answer a READ question about the user's data that list/create/update/delete can't — needs a filter, " +
		'a join across two relationship types, or a count/aggregate (e.g. "who owns >3 companies?", "how many ' +
		'todos are done?", "todos due this week"). A specialist authors + runs a validated query; you get the ' +
		'rows. Simple single-type lists → data_crud; changes → mutate.',
	parameters: {
		type: 'object',
		required: ['request'],
		properties: {
			request: {
				type: 'string',
				description: 'The question in plain language, e.g. "done todos" or "todos due before friday".'
			},
			response: { type: 'string', description: 'A short human-facing reply to show the user.' }
		}
	}
}
const LLM = { model: 'glm-5-2', effort: 'high' }
const CONTEXT = ['predicates']
const jsonb = (v: unknown) => sql`${JSON.stringify(v)}::jsonb`

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		INSERT INTO actor (id, skill_id, name, engine, mailbox, llm, context, hitl, position, created_at, updated_at)
		VALUES (${ID}, 'todos', 'query', 'query', ${jsonb(MAILBOX)}, ${jsonb(LLM)}, ${jsonb(CONTEXT)}, false, 1, now(), now())
		ON CONFLICT (id) DO UPDATE SET
			mailbox = EXCLUDED.mailbox, llm = EXCLUDED.llm, context = EXCLUDED.context, updated_at = now()
	`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DELETE FROM actor WHERE id = ${ID}`.execute(db)
}
