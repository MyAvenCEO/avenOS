import type { Context } from 'hono'

/**
 * In-process per-user pub/sub for realtime invalidation. The betterauth server is a single
 * fly machine, so an in-memory fan-out keyed by userId is enough (no Redis / PG NOTIFY). Every
 * server-side mutation calls `publish(userId, {entity})`; the SSE handler subscribes the
 * connected user and forwards their events to the app, which maps `{entity}` → invalidate the
 * matching TanStack Query keys. board 0055.
 *
 * NOTE: this module deliberately does NOT import `./auth` at the top level (auth.ts reads env
 * at load). `eventsStream` imports it lazily so `publish`/`subscribe` stay unit-testable
 * without the server's env.
 */
export type ChangeEvent = { entity: 'data' | 'usage' | 'billing' }

type Listener = (ev: ChangeEvent) => void
const listeners = new Map<string, Set<Listener>>()

/** Subscribe a listener to a user's change events. Returns an unsubscribe function. */
export function subscribe(userId: string, fn: Listener): () => void {
	let set = listeners.get(userId)
	if (!set) {
		set = new Set()
		listeners.set(userId, set)
	}
	set.add(fn)
	return () => {
		set?.delete(fn)
		if (set && set.size === 0) listeners.delete(userId)
	}
}

/** Fan a change event out to all of a user's open SSE streams. No-op when none are connected. */
export function publish(userId: string | null | undefined, ev: ChangeEvent): void {
	if (!userId) return
	const set = listeners.get(userId)
	if (!set) return
	for (const fn of set) {
		try {
			fn(ev)
		} catch {
			/* a dead stream must not break the others */
		}
	}
}

/**
 * Session-gated SSE stream of the user's change events. Consumed by the app over `fetch` (so it
 * can send the bearer token — `EventSource` can't), which maps each `{entity}` to
 * `queryClient.invalidateQueries`. A comment keep-alive every 25s stops idle proxies dropping it.
 */
export async function eventsStream(c: Context): Promise<Response> {
	const { auth } = await import('./auth')
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	const userId = session.user.id

	const encoder = new TextEncoder()
	let unsubscribe: (() => void) | null = null
	let keepAlive: ReturnType<typeof setInterval> | null = null

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const enqueue = (text: string) => {
				try {
					controller.enqueue(encoder.encode(text))
				} catch {
					/* stream closed between events */
				}
			}
			enqueue(': connected\n\n')
			unsubscribe = subscribe(userId, (ev) => enqueue(`data: ${JSON.stringify(ev)}\n\n`))
			keepAlive = setInterval(() => enqueue(': ping\n\n'), 25_000)
		},
		cancel() {
			unsubscribe?.()
			if (keepAlive) clearInterval(keepAlive)
		}
	})

	return new Response(stream, {
		status: 200,
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	})
}
