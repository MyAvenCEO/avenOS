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

/** Build the SCHEMA-FREE Tier-1 router request. No `tools`, no hint, no lexicon — by construction. */
export function buildRouterRequest(userText: string, model: string): RouterRequest {
	const menu = (Object.keys(SKILL_REGISTRY) as SkillId[])
		.map((id) => `- ${id}: ${SKILL_REGISTRY[id].description}`)
		.join('\n')
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

/** Parse a router reply to a known SkillId — first skill id that appears as a whole word wins; anything
 *  unknown falls back to DEFAULT_SKILL (so a mis-route degrades to the common case, never to nothing). */
export function parseSkillId(raw: string): SkillId {
	const t = (raw ?? '').toLowerCase()
	for (const id of Object.keys(SKILL_REGISTRY) as SkillId[]) {
		if (new RegExp(`\\b${id}\\b`).test(t)) return id
	}
	return DEFAULT_SKILL
}

/** Tier 1 — route a turn to its skill. `callLLM` runs the schema-free request and returns the raw reply
 *  text; it is injected so the routing logic is unit-testable without a live model. Empty input or any
 *  error falls back to DEFAULT_SKILL. */
export async function routeSkill(
	callLLM: (req: RouterRequest) => Promise<string>,
	userText: string,
	model: string
): Promise<SkillId> {
	if (!userText.trim()) return DEFAULT_SKILL
	try {
		return parseSkillId(await callLLM(buildRouterRequest(userText, model)))
	} catch {
		return DEFAULT_SKILL
	}
}

/** Tier 3 gating — only the todos skill needs the live task-list snapshot (with ids) merged into its
 *  system prompt; every other route stays lean (and skips the DB read entirely). */
export function skillWantsTodosHint(skillId: SkillId): boolean {
	return skillId === 'todos'
}

/** Tier 3 — assemble a skill's system context: merge the todos snapshot hint ONLY on the todos route. */
export function assembleSystemContext(skillId: SkillId, baseSystem: string, hint: string): string {
	return skillWantsTodosHint(skillId) && hint ? `${baseSystem}\n\n${hint}`.trim() : baseSystem
}
