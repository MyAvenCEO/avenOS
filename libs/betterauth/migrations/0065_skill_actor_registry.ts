import { CREATE_INSTRUCTIONS, chatToolDefinitions, SKILL_REGISTRY } from '@avenos/skills/tools'
import { type Kysely, sql } from 'kysely'

// board 0110 — SKILL + ACTOR registries as config-as-data. An ACTOR is the atomic worker as ONE row:
// `engine` (handler resolved by name — the only part that stays code) XOR `code` (sandboxed QuickJS, lands
// in 0111 — the columns exist NOW so 0111 needs no schema change) · `mailbox` (the tool definition the model
// sees) · `llm` (model+effort) · `prompt` (its system/instruction prompt) · `context` (Tier-3 providers) ·
// `vibe` · `hitl`. A SKILL is a named collection of actors + a workflow. Seeded to PARITY from the current
// TS registries (SKILL_REGISTRY + each tool's definition + CREATE_INSTRUCTIONS): the hardcoded maps become
// the SEED, the DB becomes the source of truth — same pattern as data_bundles / data_operations. The
// runtime then reads config from here (see src/config.ts); a fresh row → a new routable skill / advertised
// actor with ZERO code.

const GEMMA = { model: 'gemma4-31b' }
const GLM = { model: 'glm-5-2', effort: 'high' }
// which seeded actors author with GLM (their behavior calls the specialist model) vs are driven by the chat model.
const GLM_ACTORS = new Set(['ontology', 'query', 'mutate', 'bundle'])
// the ontology CREATE actor carries the mint prompt as data; the rest have none (their instructions live in
// the chat/tool descriptions). board 0110 — prompt-as-data (0111 extends this to all specialist prompts).
const PROMPTS: Record<string, string> = { ontology: CREATE_INSTRUCTIONS }
const CONTEXT: Record<string, string[]> = { ontology: ['predicates'], query: ['predicates'], mutate: ['predicates'], bundle: ['predicates'] }

export async function up(db: Kysely<unknown>): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS skill (
			id text PRIMARY KEY,
			label text NOT NULL,
			description text NOT NULL DEFAULT '',
			workflow jsonb,
			position int NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db)
	await sql`
		CREATE TABLE IF NOT EXISTS actor (
			id text PRIMARY KEY,
			skill_id text NOT NULL,
			name text NOT NULL,
			engine text,
			code text,
			caps jsonb,
			mailbox jsonb,
			llm jsonb,
			prompt text,
			context jsonb,
			vibe text,
			hitl boolean NOT NULL DEFAULT false,
			position int NOT NULL DEFAULT 0,
			created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now()
		)
	`.execute(db)
	await sql`CREATE INDEX IF NOT EXISTS actor_skill ON actor (skill_id, position)`.execute(db)

	// tool definitions (mailboxes) by name — the model-facing config each actor advertises.
	const defByName = new Map(chatToolDefinitions().map((d) => [d.function.name, d]))
	const skillIds = Object.keys(SKILL_REGISTRY) as (keyof typeof SKILL_REGISTRY)[]

	for (let s = 0; s < skillIds.length; s++) {
		const id = skillIds[s]
		const sk = SKILL_REGISTRY[id]
		await sql`
			INSERT INTO skill (id, label, description, position)
			VALUES (${id}, ${sk.label}, ${sk.description}, ${s})
			ON CONFLICT (id) DO NOTHING
		`.execute(db)
		for (let a = 0; a < sk.tools.length; a++) {
			const name = sk.tools[a]
			const def = defByName.get(name)
			const mailbox = def ? { description: def.function.description, parameters: def.function.parameters } : null
			const llm = GLM_ACTORS.has(name) ? GLM : GEMMA
			await sql`
				INSERT INTO actor (id, skill_id, name, engine, mailbox, llm, prompt, context, hitl, position)
				VALUES (
					${name}, ${id}, ${name}, ${name},
					${mailbox ? sql`${JSON.stringify(mailbox)}::jsonb` : null},
					${sql`${JSON.stringify(llm)}::jsonb`},
					${PROMPTS[name] ?? null},
					${CONTEXT[name] ? sql`${JSON.stringify(CONTEXT[name])}::jsonb` : null},
					false, ${a}
				)
				ON CONFLICT (id) DO NOTHING
			`.execute(db)
		}
	}
}

export async function down(db: Kysely<unknown>): Promise<void> {
	await sql`DROP TABLE IF EXISTS actor`.execute(db)
	await sql`DROP TABLE IF EXISTS skill`.execute(db)
}
