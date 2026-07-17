// avenVOICE server tools (board: aven-voice) — the voice session gets the SAME
// tool surface as chat: every skill's advertised tools, executed through the
// same TOOL_ACTORS registry with the same capability context ai.ts injects.
// One registry line adds a tool to chat AND voice; nothing is client-side.

import { TOOL_ACTORS } from '@avenos/skills/tools'
import type { VoiceServerTools } from '@avenos/aven-voice/server'
import { crud, runNamedOp } from './actor-run'
import { chatToolDefinitionsFor, skillMenu } from './config'
import { mockupCaps } from './mockup-caps'
import { ontologyCaps } from './ontology'
import { promoteCaps } from './promote-caps'
import { mutationCaps, queryCaps } from './query-caps'
import { typeCaps } from './type-caps'

/**
 * Union of all skills' chat tools, converted to Live-API declarations.
 * Voice spans skills within one session, so unlike chat (which advertises
 * per-dispatched-skill) the whole menu is available; the actor registry is
 * still the single execution gate.
 */
export async function voiceToolDeclarations(): Promise<VoiceServerTools['declarations']> {
	const menu = await skillMenu()
	const seen = new Map<string, VoiceServerTools['declarations'][number]>()
	for (const skill of menu) {
		const defs = await chatToolDefinitionsFor(skill.id).catch(() => [])
		for (const d of defs) {
			if (seen.has(d.function.name)) continue
			seen.set(d.function.name, {
				name: d.function.name,
				description: d.function.description ?? '',
				parametersJsonSchema: d.function.parameters ?? { type: 'object', properties: {} }
			})
		}
	}
	return [...seen.values()]
}

/** The same capability context ai.ts hands to actors (streaming emitters are no-ops for voice). */
function voiceCtx(userId: string) {
	const noop = (): void => {}
	return {
		userId,
		data: (a: Parameters<typeof crud>[1]) => crud(userId, a),
		ops: (n: string, p?: Record<string, unknown>) => runNamedOp(userId, n, p ?? {}),
		ontology: ontologyCaps(userId),
		query: queryCaps(userId),
		mutate: mutationCaps(userId),
		bundle: typeCaps(userId),
		mockup: mockupCaps(noop),
		promote: promoteCaps(userId, noop)
	}
}

export async function buildVoiceServerTools(userId: string): Promise<VoiceServerTools> {
	const declarations = await voiceToolDeclarations()
	return {
		declarations,
		async execute(name, args) {
			const actor = TOOL_ACTORS[name]
			if (!actor) return { content: { ok: false, error: `tool "${name}" is not available` } }
			const out = await actor.handle(
				voiceCtx(userId) as Parameters<(typeof actor)['handle']>[0],
				(args ?? {}) as Parameters<(typeof actor)['handle']>[1]
			)
			return { content: out.content, hitl: out.hitl, detail: out.detail }
		}
	}
}
