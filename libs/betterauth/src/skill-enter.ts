import type { Context } from 'hono'
import { sql } from 'kysely'
import { crud, runCodeActor } from './actor-run'
import { auth } from './auth'
import { db } from './db'

// board 0119 — the SKILL MANIFEST: config on the skill row declaring the DEFAULT entry view. When a
// skill is opened (left-aside click) or a prompt routes to it, the stage grounds the user in the
// skill's context FIRST (banking → overview with real balance+transactions; inventory → the live
// inventory; todos → the live todos view) — then the specific actor's card follows. Manifest shapes:
//   { actor:  "<name>" }                — run this DB code actor (scoped caps) → its vibe + state
//   { schema: "<type>", vibe?: "<v>" }  — crud list the schema → the vibe with { items }
//   { vibe:   "<name>" }                — vibe only (client renders it live/example: todos, composer)

export type SkillManifest = { actor?: string; schema?: string; vibe?: string }
export type EnterResult = { vibe: string; data?: Record<string, unknown> } | null

export async function enterSkillView(uid: string, skillId: string): Promise<EnterResult> {
	const D = db()
	const row = await sql<{ manifest: unknown }>`
		SELECT manifest FROM skill WHERE id = ${skillId} LIMIT 1
	`.execute(D)
	if (!row.rows.length) return null
	const m = (
		typeof row.rows[0].manifest === 'string'
			? JSON.parse(row.rows[0].manifest as string)
			: row.rows[0].manifest
	) as SkillManifest | null
	if (!m) return null
	if (m.actor) {
		const a = await sql<{ name: string; code: string | null; caps: unknown; prompt: string | null; engine: string | null; vibe: string | null }>`
			SELECT name, code, caps, prompt, engine, vibe FROM actor WHERE skill_id = ${skillId} AND name = ${m.actor} LIMIT 1
		`.execute(D)
		const actor = a.rows[0]
		if (!actor?.code) return m.vibe ? { vibe: m.vibe } : null
		const caps = (typeof actor.caps === 'string' ? JSON.parse(actor.caps as string) : actor.caps) as string[]
		try {
			const run = await runCodeActor(
				{ name: actor.name, code: actor.code, caps, prompt: actor.prompt, engine: actor.engine },
				{},
				uid
			)
			return {
				vibe: actor.vibe ?? m.vibe ?? skillId,
				data: run.ran ? (run.result as Record<string, unknown>) : undefined
			}
		} catch (e) {
			console.error('[enter] default actor failed:', e)
			return m.vibe ? { vibe: m.vibe } : null
		}
	}
	if (m.schema) {
		try {
			const res = (await crud(uid, { schema: m.schema, action: 'list' })) as { items?: unknown[] }
			return { vibe: m.vibe ?? m.schema, data: { items: res.items ?? [] } }
		} catch (e) {
			console.error('[enter] default list failed:', e)
			return m.vibe ? { vibe: m.vibe } : null
		}
	}
	return m.vibe ? { vibe: m.vibe } : null
}

/** GET /api/skills/:id/enter — the session user's default view of a skill. */
export async function skillEnter(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const view = await enterSkillView(session.user.id, String(c.req.param('id') ?? ''))
	return c.json({ view })
}
