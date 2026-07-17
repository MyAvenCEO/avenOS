// avenVOICE server tools (board: aven-voice) — the voice session gets the SAME
// tool surface as chat, fully DYNAMIC and with identical semantics:
//   • declarations: skillMenu() × chatToolDefinitionsFor() (DB-driven config)
//   • TS actors: TOOL_ACTORS registry, same capability ctx ai.ts injects,
//     the actor's own `out.vibe` declarations drive the stage (board 0118)
//   • DB-only actors (config-minted skills, e.g. banking): resolved by name
//     via actorConfig() and run sandboxed through runCodeActor — their
//     `vibe` + returned state feed the vibe card (board 0113)
// One registry/config row adds a tool to chat AND voice; nothing is hardcoded.

import { TOOL_ACTORS } from '@avenos/skills/tools'
import type { VoiceServerTools } from '@avenos/aven-voice/server'
import { crud, runCodeActor, runNamedOp } from './actor-run'
import { actorConfig, chatToolDefinitionsFor, skillMenu } from './config'
import { schemasPromptHint } from './data'
import { mockupCaps } from './mockup-caps'
import { ontologyCaps } from './ontology'
import { promoteCaps } from './promote-caps'
import { mutationCaps, queryCaps } from './query-caps'
import { typeCaps } from './type-caps'
import { vibeExists } from './vibe-registry'

type VoiceVibe = { schema: string; data?: unknown }

/**
 * Tools whose chat implementation needs the CLIENT'S files round-tripped per
 * turn (website source lives in Tauri fs) — the voice protocol doesn't carry
 * that yet, so they are not advertised rather than advertised-but-broken.
 * board aven-voice follow-up: file roundtrip over the voice WS.
 */
const NOT_VOICE_READY = new Set(['edit_website', 'deploy_website'])

/**
 * Union of all skills' chat tools + the per-skill data_crud SCHEMA BINDINGS.
 * Voice spans skills in ONE session, so the generic data_crud is advertised
 * once — but each skill binds data_crud to its own schema in the tool
 * description (todos→todos, inventory→inventory, banking→transaction). We
 * harvest those bindings so the model knows the real schema names (SSOT: the
 * skill configs themselves) instead of guessing.
 */
export async function voiceToolSurface(): Promise<{
	declarations: VoiceServerTools['declarations']
	schemaBindings: string[]
}> {
	const menu = await skillMenu()
	const seen = new Map<string, VoiceServerTools['declarations'][number]>()
	const bindings: string[] = []
	for (const skill of menu) {
		const defs = await chatToolDefinitionsFor(skill.id).catch(() => [])
		for (const d of defs) {
			if (d.function.name === 'data_crud') {
				const desc = String(d.function.description ?? '')
				// pull the bound schema from the skill's data_crud param description
				const schemaDesc = String(
					(d.function.parameters?.properties as { schema?: { description?: string } } | undefined)
						?.schema?.description ?? ''
				)
				const m = (schemaDesc + ' ' + desc).match(/"([a-z0-9_-]+)"/i)
				if (m) bindings.push(`- Skill "${skill.id}": data_crud schema = "${m[1]}"`)
			}
			if (NOT_VOICE_READY.has(d.function.name)) continue
			if (seen.has(d.function.name)) continue
			seen.set(d.function.name, {
				name: d.function.name,
				description: d.function.description ?? '',
				parametersJsonSchema: d.function.parameters ?? { type: 'object', properties: {} }
			})
		}
	}
	return { declarations: [...seen.values()], schemaBindings: bindings }
}

/** Back-compat: declarations only. */
export async function voiceToolDeclarations(): Promise<VoiceServerTools['declarations']> {
	return (await voiceToolSurface()).declarations
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

/** Same guard chat applies: a schema without vibe rows gets no card. */
async function existingVibes(vibes: VoiceVibe[]): Promise<VoiceVibe[]> {
	const out: VoiceVibe[] = []
	for (const v of vibes) {
		if (await vibeExists(v.schema).catch(() => true)) out.push(v)
	}
	return out
}

export async function buildVoiceServerTools(userId: string): Promise<VoiceServerTools> {
	const { declarations, schemaBindings } = await voiceToolSurface()
	const hint = await schemasPromptHint(userId).catch(() => '')
	const instructionsSuffix = [
		'Verfügbare data_crud-Schemas je Skill (nutze EXAKT diese Namen, rate nie):',
		...schemaBindings,
		hint,
		'Für einen anderen Bereich wechselst du einfach das schema-Feld von data_crud.',
		'Zum Löschen oder gezielten Ändern: rufe ZUERST list auf, dann delete/update mit den ECHTEN ids aus dem Ergebnis — niemals mit einem filter statt ids.'
	]
		.filter(Boolean)
		.join('\n')
	return {
		declarations,
		instructionsSuffix,
		async execute(name, rawArgs) {
			const args = (rawArgs ?? {}) as Record<string, unknown>

			// 0) show_website — same contract as chat: the composer vibe is
			//    client-special-cased (viewer reads local files), no registry row.
			if (name === 'show_website') {
				return {
					content: { ok: true, shown: 'website composer (read-only)' },
					detail: 'website viewer ready',
					vibes: [{ schema: 'composer' }]
				}
			}

			// data_crud delete/update with a filter but no ids: the actor honors ids
			// only, so resolve the filter to real ids FIRST (the voice model tends to
			// pass filters). Keeps HITL delete + targeted update working end-to-end.
			if (
				name === 'data_crud' &&
				typeof args.schema === 'string' &&
				['delete', 'update'].includes(String(args.action)) &&
				args.filter &&
				!(Array.isArray(args.ids) && args.ids.length)
			) {
				const listed = await crud(userId, {
					schema: args.schema,
					action: 'list',
					filter: args.filter
				} as Parameters<typeof crud>[1]).catch(() => null)
				const rows = ((listed as { items?: unknown } | null)?.items ?? listed) as
					| { id?: unknown }[]
					| undefined
				const ids = Array.isArray(rows)
					? rows.map((r) => r?.id).filter((x): x is string => typeof x === 'string')
					: []
				if (ids.length) {
					args.ids = ids
					delete args.filter
				}
			}

			// 1) TS actor (skills/tools registry) — the actor declares its vibes.
			const actor = TOOL_ACTORS[name]
			if (actor) {
				const out = await actor.handle(
					voiceCtx(userId) as Parameters<(typeof actor)['handle']>[0],
					args
				)
				const declared = out.vibe ? (Array.isArray(out.vibe) ? out.vibe : [out.vibe]) : []
				let vibes = await existingVibes(declared as VoiceVibe[])
				// Realtime refresh: a mutation whose declared `<schema>-edited` card has no
				// DB rows (e.g. inventory) would leave a stale stage. Fall back to re-pushing
				// the BASE list vibe with fresh data so the stage reflects the mutation —
				// generic for any schema, same effect todos gets from its -edited card.
				const schema = typeof args.schema === 'string' ? args.schema : ''
				const isMutation =
					name === 'data_crud' && ['create', 'update', 'delete'].includes(String(args.action))
				if (isMutation && schema && vibes.length === 0 && (await vibeExists(schema).catch(() => false))) {
					const fresh = await crud(userId, { schema, action: 'list' } as Parameters<typeof crud>[1])
					const rows = (fresh as { items?: unknown } | undefined)?.items ?? fresh
					vibes = [{ schema, data: { items: rows } }]
				}
				return { content: out.content, hitl: out.hitl, detail: out.detail, vibes }
			}

			// 2) DB-only actor (config-minted skill, board 0113): sandboxed code, its
			//    `vibe` + returned state feed the card — same contract as chat.
			const dbActor = await actorConfig(name).catch(() => null)
			if (dbActor?.code) {
				const run = await runCodeActor(dbActor, args, userId)
				const state = run.ran ? (run.result as Record<string, unknown>) : null
				const vibes =
					state && dbActor.vibe
						? await existingVibes([{ schema: dbActor.vibe, data: state }])
						: []
				return {
					content: state ?? { ok: false, error: 'actor run failed' },
					detail: dbActor.vibe ?? name,
					vibes
				}
			}

			return { content: { ok: false, error: `tool "${name}" is not available` } }
		}
	}
}
