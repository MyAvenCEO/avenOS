// board 0106 — the DISPATCH SKILL: Tier 1 of progressive tool/context loading. A minimal gemma router
// reads the human request and delegates it to ONE destination skill; the server then advertises only
// that skill's tools (Tier 2) and loads its heavy context only when the actor runs (Tier 3). The router
// prompt is deliberately SCHEMA-FREE — no tool schemas, no todos snapshot, no gismu lexicon — just a
// terse skill menu + the user's message, so the extra per-turn call stays tiny and fast.

import { DEFAULT_SKILL, SKILL_REGISTRY, type SkillId } from './registry'

/** The minimal OpenAI-style body for the router call: a skill menu + the user message, nothing else. */
export type RouterRequest = {
	model: string
	messages: { role: 'system' | 'user'; content: string }[]
	max_tokens: number
	temperature: number
	stream: false
}

/** One entry of the router menu: the skill id + how to recognize when it's the right skill. board 0110 —
 *  the menu is passed in (from the DB `skill` table) so the router is fully config-as-data; it defaults to
 *  the TS SKILL_REGISTRY so the skills-package unit tests + any DB-less path still work. */
export type SkillMenuItem = { id: string; description: string }

const tsMenu = (): SkillMenuItem[] =>
	(Object.keys(SKILL_REGISTRY) as SkillId[]).map((id) => ({
		id,
		description: SKILL_REGISTRY[id].description
	}))

/** Build the SCHEMA-FREE Tier-1 router request. No `tools`, no hint, no lexicon — by construction. */
export function buildRouterRequest(
	userText: string,
	model: string,
	skills?: SkillMenuItem[]
): RouterRequest {
	const menu = (skills ?? tsMenu()).map((s) => `- ${s.id}: ${s.description}`).join('\n')
	const system =
		'You are a router. Read the user message and reply with EXACTLY ONE skill id from this list — ' +
		'just the id, lowercase, no punctuation, no explanation:\n' +
		menu
	return {
		model,
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: userText }
		],
		max_tokens: 8,
		temperature: 0,
		stream: false
	}
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Parse a router reply to a known skill id — first id that appears as a whole word wins; anything unknown
 *  falls back to DEFAULT_SKILL (so a mis-route degrades to the common case, never to nothing). */
export function parseSkillId(raw: string, ids?: string[]): string {
	const t = (raw ?? '').toLowerCase()
	for (const id of ids ?? (Object.keys(SKILL_REGISTRY) as string[])) {
		if (new RegExp(`\\b${escapeRe(id.toLowerCase())}\\b`).test(t)) return id
	}
	return DEFAULT_SKILL
}

/** Tier 1 — route a turn to its skill. `callLLM` runs the schema-free request and returns the raw reply
 *  text; it is injected so the routing logic is unit-testable without a live model. `skills` (from the DB)
 *  makes routing dynamic; omitted → the TS seed. Empty input or any error falls back to DEFAULT_SKILL. */
export async function routeSkill(
	callLLM: (req: RouterRequest) => Promise<string>,
	userText: string,
	model: string,
	skills?: SkillMenuItem[]
): Promise<string> {
	if (!userText.trim()) return DEFAULT_SKILL
	try {
		return parseSkillId(
			await callLLM(buildRouterRequest(userText, model, skills)),
			skills?.map((s) => s.id)
		)
	} catch {
		return DEFAULT_SKILL
	}
}

/** Tier 3 gating — only the todos skill needs the live task-list snapshot (with ids) merged into its
 *  system prompt; every other route stays lean (and skips the DB read entirely). */
export function skillWantsTodosHint(skillId: string): boolean {
	return skillId === 'todos'
}

/** Tier 3 — assemble a skill's system context: merge the todos snapshot hint ONLY on the todos route. */
export function assembleSystemContext(skillId: string, baseSystem: string, hint: string): string {
	return skillWantsTodosHint(skillId) && hint ? `${baseSystem}\n\n${hint}`.trim() : baseSystem
}
