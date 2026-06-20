import { QueryClient } from '@tanstack/svelte-query'

/**
 * Single app-wide TanStack Query client for betterauth server state. Realtime invalidation is
 * pushed by the SSE stream (see ./events), so the queries themselves can stay relatively fresh
 * without aggressive polling. board 0055.
 */
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 10_000,
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
