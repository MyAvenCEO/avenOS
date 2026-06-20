import { QueryClient } from '@tanstack/svelte-query'

/**
 * App-wide TanStack Query client for betterauth server state. board 0055.
 *
 * Realtime model: a single SSE stream (see ./events) pushes per-user change events that invalidate
 * the matching query keys — TanStack Query "subscriptions". NO polling (refetchInterval) and NO
 * per-query timers: the server tells us when data changed, so queries stay fresh on push alone.
 * The acting user's own writes also invalidate instantly via createMutation.
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
			refetchOnWindowFocus: true
		}
	}
})

// Query keys — prefixes matter: the SSE consumer invalidates by prefix (`['data']`, `['usage']`,
// `['billing']`), so every key below MUST start with its entity name. board 0055.
export const qk = {
	usage: ['usage'] as const,
	billing: ['billing', 'state'] as const,
	schemas: ['data', 'schemas'] as const,
	values: (schemaId: string) => ['data', 'values', schemaId] as const
}
