import { getBearerToken } from '$lib/auth/auth-client'
import { consumeSse } from '$lib/net/sse'
import { queryClient } from './client'

// Fetch-based SSE consumer for the betterauth realtime stream (GET /api/events). EventSource
// can't send the Authorization header (WKWebView drops the cross-site cookie), so we read the
// stream over `fetch` like MainnetChat does — bearer token, auto-reconnect. Each `{entity}`
// event maps to a TanStack Query invalidation, so the UI refetches with zero manual reloads.
// board 0055.
const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

type ChangeEvent = { entity: 'data' | 'usage' | 'billing' }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function invalidate(ev: ChangeEvent): void {
	if (ev.entity === 'data') {
		void queryClient.invalidateQueries({ queryKey: ['data'] })
	} else if (ev.entity === 'usage') {
		void queryClient.invalidateQueries({ queryKey: ['usage'] })
	} else if (ev.entity === 'billing') {
		void queryClient.invalidateQueries({ queryKey: ['billing'] })
		void queryClient.invalidateQueries({ queryKey: ['usage'] }) // tier change → credits change
	}
}

let started = false
let stopFn: (() => void) | null = null

/**
 * Open the per-user SSE stream and invalidate queries on each change, reconnecting on drop.
 * Idempotent — call once at app start; it waits for the bearer token internally, so it's safe
 * to start before sign-in completes.
 */
export function startRealtime(): () => void {
	if (started) return stopFn ?? (() => {})
	started = true
	let aborted = false
	let controller: AbortController | null = null

	const run = async (): Promise<void> => {
		while (!aborted) {
			const token = getBearerToken()
			if (!BASE || !token) {
				await sleep(1000) // not signed in yet — wait for the token
				continue
			}
			controller = new AbortController()
			try {
				const res = await fetch(`${BASE}/api/events`, {
					credentials: 'include',
					headers: { Authorization: `Bearer ${token}` },
					signal: controller.signal
				})
				if (!res.ok || !res.body) {
					await sleep(2000)
					continue
				}
				// Same SSE reader the chat uses (DRY). Each frame is a change event → invalidate.
				await consumeSse(res, (data) => {
					try {
						invalidate(JSON.parse(data) as ChangeEvent)
					} catch {
						/* keep-alive comment or partial frame */
					}
				})
			} catch {
				/* network/abort error → reconnect after a backoff */
			}
			if (!aborted) await sleep(1500)
		}
	}
	void run()
	stopFn = () => {
		aborted = true
		controller?.abort()
	}
	return stopFn
}
