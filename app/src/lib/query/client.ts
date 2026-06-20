import { QueryClient } from '@tanstack/svelte-query'

/**
 * App-wide TanStack Query client for betterauth server state. board 0055.
 *
 * Realtime model: SHORT-INTERVAL POLLING + mutation invalidation — deliberately NOT a long-lived
 * SSE/EventSource connection. In WKWebView (the Tauri shell) a permanent streaming `fetch` holds
 * one of the ~6 per-host HTTP/1.1 connections open forever, which starved the AI chat's own
 * streaming POST (stalled "Thinking…", incomplete tool calls) and often didn't even deliver
 * events. Short polling requests are released immediately, so they never contend with the AI
 * stream. Each query sets its own `refetchInterval` (see POLL_MS); the acting user's own writes
 * still invalidate instantly via createMutation.
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 2_000,
			retry: 1,
			refetchOnWindowFocus: true
		}
	}
})

// Per-entity poll cadence. Cheap Neon reads poll briskly; billing hits the Polar API so it polls
// slowly (user actions invalidate it instantly anyway). board 0055.
export const POLL_MS = {
	data: 3_000,
	usage: 5_000,
	billing: 20_000
} as const

// Query keys — prefixes group related queries so a mutation can invalidate a whole entity. board 0055.
export const qk = {
	usage: ['usage'] as const,
	billing: ['billing', 'state'] as const,
	schemas: ['data', 'schemas'] as const,
	values: (schemaId: string) => ['data', 'values', schemaId] as const
}
