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
	skills?: SkillMenuItem[],
	context?: string
): RouterRequest {
	const menu = (skills ?? tsMenu()).map((s) => `- ${s.id}: ${s.description}`).join('\n')
	// board 0113 — the router reasons over the RECENT CONVERSATION, not just the last message: a
	// continuation ("weiter", "nochmal", "continue", "next step") belongs to the skill of the ongoing
	// task. LLM-smart routing — no keyword heuristics anywhere.
	const system =
		'You are a router. Reply with EXACTLY ONE skill id from this list — just the id, lowercase, no ' +
		'punctuation, no explanation:\n' +
		menu +
		'\nIf the user message continues an ongoing task visible in the recent conversation (e.g. ' +
		'"weiter", "nochmal", "continue", "next step", a bare confirmation), pick the skill of THAT task.' +
		'\nRequests about a skill/app ITSELF — creating, improving, redesigning it, changing its rules or ' +
		'behavior — belong to skillify. Requests about the DATA INSIDE a skill belong to that skill.'
	const user = context
		? `RECENT CONVERSATION:\n${context}\n\nUSER MESSAGE: ${userText}`
		: userText
	return {
		model,
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: user }
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
	skills?: SkillMenuItem[],
	context?: string
): Promise<string> {
	if (!userText.trim()) return DEFAULT_SKILL
	try {
		return parseSkillId(
			await callLLM(buildRouterRequest(userText, model, skills, context)),
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
export function assembleSystemContext(_skillId: string, baseSystem: string, hint: string): string {
	// gating happens at FETCH time (each skill decides its own hint); a provided hint always merges.
	return hint ? `${baseSystem}\n\n${hint}`.trim() : baseSystem
}
