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
import { bundleFieldContract, schemasPromptHint } from './data'
import { mockupCaps } from './mockup-caps'
import { ontologyCaps } from './ontology'
import { promoteCaps } from './promote-caps'
import { mutationCaps, queryCaps } from './query-caps'
import { typeCaps } from './type-caps'
import { vibeExists, vibeForSchema } from './vibe-registry'
import { vibeSource } from './vibe-refresh'

type VoiceVibe = { schema: string; data?: unknown }

/**
 * Gemini Live occasionally emits malformed tool args: keys wrapped in literal
 * quotes ({ '"id"': … } instead of { id: … }), JSON payloads as strings, or a
 * stray action string inside `items` (["update", {…}]). Normalize recursively
 * so actors always see clean shapes — otherwise updates silently match nothing.
 */
function sanitizeToolArgs(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(sanitizeToolArgs)
	if (v && typeof v === 'object') {
		const out: Record<string, unknown> = {}
		for (const [k, val] of Object.entries(v)) {
			out[k.trim().replace(/^"+|"+$/g, '')] = sanitizeToolArgs(val)
		}
		return out
	}
	if (typeof v === 'string') {
		const t = v.trim()
		if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
			try {
				return sanitizeToolArgs(JSON.parse(t))
			} catch {
				return v
			}
		}
	}
	return v
}

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
				// a skill may bind SEVERAL schemas (dienstplan: "slot" + "shift"); the schema
				// param description names each in quotes — harvest them all so the model knows
				// every real schema name (SSOT: the skill config).
				const schemaDesc = String(
					(d.function.parameters?.properties as { schema?: { description?: string } } | undefined)
						?.schema?.description ?? ''
				)
				const names = [...new Set([...schemaDesc.matchAll(/"([a-z0-9_-]+)"/gi)].map((mm) => mm[1]))]
				for (const n of names) bindings.push(`- Skill "${skill.id}": data_crud schema = "${n}"`)
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
	// Per-schema FIELD contract (SSOT from the bundles): tell the model the exact
	// field names up front so it never sends type/date/name and needs a retry.
	const schemaNames = [
		...new Set(schemaBindings.map((b) => b.match(/=\s*"([a-z0-9_-]+)"/i)?.[1]).filter(Boolean))
	] as string[]
	const fieldLines = (
		await Promise.all(
			schemaNames.map(async (s) => {
				const c = await bundleFieldContract(s).catch(() => null)
				return c?.fields.length ? `- "${s}": Felder ${c.fields.join(', ')}` : ''
			})
		)
	).filter(Boolean)
	const instructionsSuffix = [
		'Verfügbare data_crud-Schemas je Skill (nutze EXAKT diese Namen, rate nie):',
		...schemaBindings,
		...(fieldLines.length
			? ['create/update: pro Objekt NUR diese Felder je Schema (keine anderen Namen wie type/date/name):', ...fieldLines]
			: []),
		hint,
		'Für einen anderen Bereich wechselst du einfach das schema-Feld von data_crud.',
		'Zum Ändern oder Löschen: rufe IMMER ZUERST list auf, lies die Ergebnisse, und nutze dann delete/update mit den EXAKTEN ids daraus — nie einen Namen im id-Feld, nie einen filter. Kommt "unknown-id" zurück, enthält die Antwort die aktuelle Liste mit den echten ids: wähle daraus und rufe erneut auf.'
	]
		.filter(Boolean)
		.join('\n')
	// Session-scoped: which week of the roster the user is currently looking at, so an edit stays on
	// the planned week instead of snapping back to the current week (set by show_dienstplan / assign).
	let dienstplanWeek = 0
	return {
		declarations,
		instructionsSuffix,
		async execute(name, rawArgs) {
			const args = sanitizeToolArgs(rawArgs ?? {}) as Record<string, unknown>
			// assign_shift on the roster defaults to the week the user is viewing, and updates it.
			if (name === 'assign_shift') {
				if (!Number.isFinite(Number(args.week))) args.week = dienstplanWeek
				else dienstplanWeek = Number(args.week)
			}
			// items must be value OBJECTS — the model sometimes slips the action
			// string into the array; keep only real entries.
			if (Array.isArray(args.items)) {
				args.items = args.items.filter((x) => x && typeof x === 'object' && !Array.isArray(x))
			}

			// 0a) show_website — same contract as chat: the composer vibe is
			//    client-special-cased (viewer reads local files), no registry row.
			if (
				name === 'data_crud' &&
				typeof args.schema === 'string' &&
				['create', 'update'].includes(String(args.action)) &&
				Array.isArray(args.items)
			) {
				// Field contract: create/update items must use the schema's REAL fields.
				// The model tends to send generic names (type/date/name) — silently
				// dropped by the write layer, creating invisible partial rows. Check each
				// item against the bundle's field contract (SSOT); on any unknown field or
				// a missing primary, DON'T write — hand back the exact valid fields so the
				// model retries correctly. No aliasing.
				const contract = await bundleFieldContract(args.schema).catch(() => null)
				if (contract && contract.fields.length) {
					const allowed = new Set([...contract.fields, 'id', 'response'])
					const unknownKeys = new Set<string>()
					let missingPrimary = false
					for (const it of args.items as Record<string, unknown>[]) {
						for (const k of Object.keys(it)) if (!allowed.has(k)) unknownKeys.add(k)
						if (String(args.action) === 'create' && contract.primary && !it[contract.primary]) {
							missingPrimary = true
						}
					}
					if (unknownKeys.size || missingPrimary) {
						return {
							content: {
								ok: false,
								error: 'unknown-fields',
								message: `Nutze für "${args.schema}" GENAU diese Felder pro Objekt: ${contract.fields.join(', ')}${contract.primary ? ` (${contract.primary} ist Pflicht)` : ''}. Keine anderen Namen (nicht type/date/name), Zeiten als "HH:MM", Tag als Wochenname. Ruf create/update erneut mit diesen Feldern auf.`,
								schema: args.schema,
								fields: contract.fields,
								...(unknownKeys.size ? { rejectedFields: [...unknownKeys] } : {})
							},
							detail: `${args.schema}: bitte echte Felder verwenden`
						}
					}
				}
			}

			if (name === 'show_website') {
				return {
					content: { ok: true, shown: 'website composer (read-only)' },
					detail: 'website viewer ready',
					vibes: [{ schema: 'composer' }]
				}
			}

			// 0b) show_calendar — render the calendar vibe over the CURRENT tasks
			//     (same todos data, time-grouped view). The vibe_logic buckets by due.
			if (name === 'show_calendar') {
				const listed = await crud(userId, { schema: 'todos', action: 'list' } as Parameters<
					typeof crud
				>[1]).catch(() => null)
				const items = (listed as { items?: unknown } | null)?.items ?? listed ?? []
				return {
					content: { ok: true, shown: 'calendar' },
					detail: 'calendar',
					vibes: await existingVibes([{ schema: 'calendar', data: { items } }])
				}
			}

			// 0c) show_dienstplan — render the roster vibe over the CURRENT shifts
			//     (week overview grouped by weekday). Optional `week` pages the view
			//     (0=this, 1=next, -1=last); the vibe logic computes that week's dates.
			if (name === 'show_dienstplan') {
				const weekOffset = Number.isFinite(Number(args.week)) ? Number(args.week) : 0
				dienstplanWeek = weekOffset
				const data = await vibeSource(userId, 'dienstplan', 'shift', { weekOffset })
				return {
					content: { ok: true, shown: 'dienstplan', week: weekOffset },
					detail: 'dienstplan',
					vibes: await existingVibes([{ schema: 'dienstplan', data }])
				}
			}

			// Ids are Postgres UUIDs — the model must NEVER invent them. Instead of
			// guessing/matching server-side, we keep the intelligence in the tool loop:
			// every update/delete is checked against the LIVE rows, and if any target id
			// isn't a real one (the model passed a name, a made-up id, or a filter), we
			// DON'T execute — we hand back the actual rows (id + label) and tell the model
			// to read them and retry with the exact ids. It then self-corrects. No
			// hardcoded name-matching, no regex; the model does the picking.
			if (
				name === 'data_crud' &&
				typeof args.schema === 'string' &&
				['delete', 'update'].includes(String(args.action))
			) {
				const listed = await crud(userId, {
					schema: args.schema,
					action: 'list'
				} as Parameters<typeof crud>[1]).catch(() => null)
				const rows = (((listed as { items?: unknown } | null)?.items ?? listed) ??
					[]) as Record<string, unknown>[]
				const idSet = new Set(
					(Array.isArray(rows) ? rows : [])
						.map((r) => String(r?.id))
						.filter((x) => x && x !== 'undefined')
				)
				// An EMPTY filter ({}) is not a real filter — treat it as absent so it can't block a
				// delete-all (the model sometimes sends filter:{}).
				const hasFilter =
					!!args.filter &&
					typeof args.filter === 'object' &&
					Object.keys(args.filter as Record<string, unknown>).length > 0
				if (!hasFilter) delete args.filter
				// "Delete ALL": a delete with no ids AND no filter means every row of this
				// schema (e.g. "lösch alle Schichten"). Resolve to the real row UUIDs so the
				// HITL confirm removes the whole set — still by exact id, one confirmation.
				if (
					String(args.action) === 'delete' &&
					!(Array.isArray(args.ids) && args.ids.length) &&
					!hasFilter &&
					idSet.size
				) {
					args.ids = [...idSet]
				}
				const targets =
					String(args.action) === 'delete'
						? (Array.isArray(args.ids) ? args.ids : []).map((x) => String(x))
						: (Array.isArray(args.items) ? args.items : []).map((it) =>
								String((it as Record<string, unknown>)?.id)
							)
				const usedFilter = String(args.action) === 'delete' && hasFilter && !targets.length
				const unknown = targets.filter((id) => !idSet.has(id))
				if (usedFilter || unknown.length) {
					// Surface the real data so the model reads it and retries with true ids.
					const current = (Array.isArray(rows) ? rows : []).map((r) => ({
						id: r.id,
						label: r.title ?? r.name ?? r.label ?? r.text ?? ''
					}))
					return {
						content: {
							ok: false,
							error: 'unknown-id',
							message:
								'Nutze die EXAKTE id aus der aktuellen Liste (keine Namen, kein filter). Ruf mit diesen ids erneut auf.',
							schema: args.schema,
							items: current
						},
						detail: `${args.schema}: bitte echte id verwenden`
					}
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
				// REALTIME BY DEFAULT: every data_crud mutation refreshes the skill's vibe with
				// fresh data so the stage always reflects the change — regardless of whether the
				// vibe is named after the schema (todos, inventory) or differs (dienstplan→shift,
				// via manifest). A `list` renders the dedicated `<vibe>-list` view when the skill
				// has one (dienstplan-list = shifts per person), else the primary vibe. When the
				// actor already produced a valid card (todos-created/-edited), we keep it.
				const schema = typeof args.schema === 'string' ? args.schema : ''
				const isMutation =
					name === 'data_crud' && ['create', 'update', 'delete'].includes(String(args.action))
				const isList = name === 'data_crud' && String(args.action) === 'list'
				if ((isMutation || isList) && schema && vibes.length === 0) {
					const primary = await vibeForSchema(schema).catch(() => null)
					if (primary) {
						let target = primary
						let data: unknown
						if (isList) {
							// list: reuse the actor's already-FILTERED result; route to the dedicated
							// `<vibe>-list` view when the skill has one (dienstplan-list = per person).
							if (await vibeExists(`${primary}-list`).catch(() => false)) target = `${primary}-list`
							data = (declared[0] as VoiceVibe | undefined)?.data
							if (data === undefined) {
								const fresh = await crud(userId, { schema, action: 'list' } as Parameters<
									typeof crud
								>[1])
								data = { items: (fresh as { items?: unknown } | undefined)?.items ?? fresh }
							}
						} else {
							// mutation: push FRESH, FULL data so the stage reflects the whole current
							// state (merge-vibes fetch every schema they overlay, e.g. slots + shifts).
							// Keep the roster on the week the user is viewing, not the current week.
							const extra = target === 'dienstplan' ? { weekOffset: dienstplanWeek } : {}
							data = await vibeSource(userId, target, schema, extra)
						}
						vibes = [{ schema: target, data }]
					}
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
