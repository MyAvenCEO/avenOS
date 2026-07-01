import type { Context } from 'hono'
import { auth } from './auth'

// board 0100 — a UNIVERSAL attached-context registry. Any actor can declare `context: [{provider}]` on
// its node; a context provider resolves that key to its actual content (a reference text, a live list),
// and the config UI shows it through the ONE generic endpoint below. Domain-agnostic: no per-skill code
// here — skills register their own providers (e.g. the ontology skill registers "gismu" + "predicates").

export type ContextPayload = {
	/** how the UI renders it: raw text (a dictionary/reference) or a named list (a live registry). */
	kind: 'text' | 'list'
	label?: string
	text?: string
	items?: { name: string; gloss?: string }[]
	/** free-form metadata shown as chips (source, size, count…). */
	meta?: Record<string, unknown>
}
/** A provider resolves a context key to its content. `arg` lets one provider serve many resources of a
 *  kind (e.g. the "type" provider with arg="todos" → the todos projection recipe + schemas). */
export type ContextProvider = (uid: string, arg?: string) => Promise<ContextPayload>

const providers = new Map<string, ContextProvider>()

/** Register a context provider under a key (idempotent). Skills call this at module load. */
export function registerContextProvider(key: string, fn: ContextProvider): void {
	providers.set(key, fn)
}

/** GET /api/context/:provider?arg=… — session-gated; resolves the registered provider to its content. */
export async function contextRoute(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const key = c.req.param('provider')
	const fn = key ? providers.get(key) : undefined
	if (!fn) return c.json({ error: `no context provider "${key ?? ''}"` }, 404)
	try {
		return c.json({ provider: key, ...(await fn(session.user.id, c.req.query('arg'))) })
	} catch (e) {
		return c.json({ error: e instanceof Error ? e.message : String(e) }, 500)
	}
}
