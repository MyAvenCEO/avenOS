import {
	buildRouterRequest,
	chatToolDefinitions as tsToolDefs,
	SKILL_REGISTRY as TS_SKILLS,
	type ToolDefinition,
	TOOL_ACTORS
} from '@avenos/skills/tools'
import { sql } from 'kysely'
import { registerContextProvider } from './context'
import { db } from './db'

// board 0110 — the runtime resolver for the config-as-data skill + actor registries. The DB `skill`/`actor`
// tables are the source of truth; the TS SKILL_REGISTRY / tool definitions are the SEED (migration 0065) and
// a FAIL-SAFE fallback (if the tables are empty/unreachable, behavior is identical to before). Behavior stays
// code: an actor's `engine` names a handler in TOOL_ACTORS, resolved BY NAME. A fresh `skill`+`actor` row →
// a new routable skill / advertised actor with zero code. Reads hit the DB each call (a handful of tiny rows,
// negligible next to the per-turn LLM roundtrip) so a newly-written row is seen immediately.

export type ActorRow = {
	id: string
	skill_id: string
	name: string
	engine: string | null
	code: string | null
	caps: string[] | null
	mailbox: { description?: string; parameters?: Record<string, unknown> } | null
	llm: { model?: string; effort?: string } | null
	prompt: string | null
	context: string[] | null
	vibe: string | null
	hitl: boolean
	position: number
}
export type SkillRow = { id: string; label: string; description: string; manifest: unknown; position: number }

/** jsonb may arrive parsed (neon) or as a string — normalize either way. */
function j<T>(v: unknown): T | null {
	if (v == null) return null
	if (typeof v === 'string') {
		try {
			return JSON.parse(v) as T
		} catch {
			return null
		}
	}
	return v as T
}

export async function readSkills(): Promise<SkillRow[]> {
	const r = await sql<SkillRow>`
		SELECT id, label, description, manifest, position FROM skill ORDER BY position, id
	`.execute(db())
	return r.rows
}

export async function readActors(skillId?: string): Promise<ActorRow[]> {
	const rows = skillId
		? (
				await sql`
					SELECT id, skill_id, name, engine, code, caps, mailbox, llm, prompt, context, vibe, hitl, position
					FROM actor WHERE skill_id = ${skillId} ORDER BY position, name
				`.execute(db())
			).rows
		: (
				await sql`
					SELECT id, skill_id, name, engine, code, caps, mailbox, llm, prompt, context, vibe, hitl, position
					FROM actor ORDER BY skill_id, position, name
				`.execute(db())
			).rows
	return (rows as Record<string, unknown>[]).map((r) => ({
		id: String(r.id),
		skill_id: String(r.skill_id),
		name: String(r.name),
		engine: (r.engine as string | null) ?? null,
		code: (r.code as string | null) ?? null,
		caps: j<string[]>(r.caps),
		mailbox: j<ActorRow['mailbox']>(r.mailbox),
		llm: j<ActorRow['llm']>(r.llm),
		prompt: (r.prompt as string | null) ?? null,
		context: j<string[]>(r.context),
		vibe: (r.vibe as string | null) ?? null,
		hitl: r.hitl === true,
		position: Number(r.position ?? 0)
	}))
}

/** A skill's manifest config (entry views, hint providers, system flag) — jsonb-parsed. board 0119q. */
export type SkillManifest = {
	system?: boolean
	hint_providers?: string[]
	hint_static?: string
} & Record<string, unknown>
export async function skillManifest(id: string): Promise<SkillManifest | null> {
	const rows = await readSkills().catch(() => [] as SkillRow[])
	return j<SkillManifest>(rows.find((s) => s.id === id)?.manifest ?? null)
}

/** The dispatch router menu: skill id + description, from the DB (fallback: the TS seed). board 0110.
 *  board 0119q — manifest {"system": true} skills (the dispatcher itself) are never routing targets. */
export async function skillMenu(): Promise<{ id: string; description: string }[]> {
	try {
		const rows = await readSkills()
		const routable = rows.filter((s) => j<SkillManifest>(s.manifest)?.system !== true)
		if (routable.length) return routable.map((s) => ({ id: s.id, description: s.description }))
	} catch {
		/* fall through to the TS seed */
	}
	return (Object.keys(TS_SKILLS) as (keyof typeof TS_SKILLS)[]).map((id) => ({
		id,
		description: TS_SKILLS[id].description
	}))
}

/** Tier 2 — the tool/actor names a routed skill advertises, from the DB (fallback: TS). board 0110. */
export async function advertisedTools(skillId: string): Promise<string[]> {
	try {
		const actors = await readActors(skillId)
		if (actors.length) return actors.map((a) => a.name)
	} catch {
		/* fall through */
	}
	return (TS_SKILLS as Record<string, { tools: string[] }>)[skillId]?.tools ?? []
}

/** Tier 2 — the routed skill's tool DEFINITIONS, built from the actors' mailboxes in the DB (fallback: TS). */
export async function chatToolDefinitionsFor(skillId: string): Promise<ToolDefinition[]> {
	try {
		const actors = await readActors(skillId)
		const withMailbox = actors.filter((a) => a.mailbox)
		if (withMailbox.length)
			return withMailbox.map((a) => ({
				type: 'function' as const,
				function: {
					name: a.name,
					description: a.mailbox?.description,
					parameters: a.mailbox?.parameters
				}
			}))
	} catch {
		/* fall through */
	}
	const want = new Set((TS_SKILLS as Record<string, { tools: string[] }>)[skillId]?.tools ?? [])
	return tsToolDefs().filter((d) => want.has(d.function.name))
}

/** An actor's full config row by name — for its prompt / llm / context at fire time. board 0110. */
export async function actorConfig(name: string): Promise<ActorRow | null> {
	const rows = await readActors()
	return rows.find((a) => a.name === name) ?? null
}

/** Behavior stays code: resolve an actor's engine handler by name. board 0110 (0111 adds sandboxed `code`). */
export function engineFor(name: string): (typeof TOOL_ACTORS)[string] | undefined {
	return TOOL_ACTORS[name]
}

// board 0110 — the DB viewer's SKILLS / ACTORS / RUNS categories read through the ONE generic context
// endpoint (like bundles/operations/vibes), so the viewer stays domain-agnostic.
registerContextProvider('skills', async () => {
	const rows = await readSkills().catch(() => [])
	return {
		kind: 'list',
		label: 'Skills',
		items: rows.map((s) => ({ name: s.id, gloss: s.description }))
	}
})
registerContextProvider('actors', async () => {
	const rows = await readActors().catch(() => [])
	return {
		kind: 'list',
		label: 'Actors',
		// board 0114 — the FULL per-actor config rides along so the DB viewer's Actors pane shows the
		// whole row (binding, mailbox schema, llm, prompt, context, caps, vibe, hitl) — config IS data,
		// so the viewer surfaces all of it, not a one-line gloss.
		items: rows.map((a) => ({
			name: a.name,
			gloss: a.mailbox?.description ?? '',
			tag: a.skill_id,
			config: {
				binding: a.code ? 'code' : 'engine',
				engine: a.engine,
				code: a.code,
				caps: a.caps,
				mailbox: a.mailbox,
				llm: a.llm,
				prompt: a.prompt,
				// where the prompt comes from: a DB config row (editable via improve_skill) — engine
				// actors without one run no roundtrip of their own.
				promptSource: a.prompt ? 'db' : null,
				context: a.context,
				vibe: a.vibe,
				hitl: a.hitl,
				position: a.position
			}
		}))
	}
})
// board 0119q — PROMPT TRANSPARENCY: assemble the router system prompt exactly like the live turn
// does — the DB `dispatch` actor prompt (migration 0114) rendered with the live skill menu; the TS
// scaffold only ever fires as the fail-safe (and is flagged as such).
registerContextProvider('dispatch_prompt', async () => {
	const [menu, dispatchActor] = await Promise.all([
		skillMenu(),
		actorConfig('dispatch').catch(() => null)
	])
	const scaffold = dispatchActor?.prompt ?? undefined
	const req = buildRouterRequest('<user message>', '<model>', menu, undefined, scaffold)
	return {
		kind: 'text',
		label: 'Dispatch router system prompt',
		text: req.messages[0]?.content ?? '',
		meta: {
			source: scaffold ? 'db config — actor "dispatch" (skill dispatch)' : 'hardcoded TS fallback',
			note: 'skill menu resolved LIVE from the DB skill table at every turn'
		}
	}
})
registerContextProvider('runs', async (uid) => {
	const r = await sql`
		SELECT flow_id, label, status FROM flow_run WHERE user_id = ${uid}
		ORDER BY created_at DESC LIMIT 100
	`.execute(db())
	return {
		kind: 'list',
		label: 'Runs',
		items: (r.rows as { flow_id: string; label: string | null; status: string }[]).map((row) => ({
			name: row.label || row.flow_id,
			gloss: row.status,
			tag: row.flow_id
		}))
	}
})
