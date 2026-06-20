import { getBearerToken } from '$lib/auth/auth-client'

// Usage + weekly credit (MINDS) state. Read via TanStack Query (key `qk.usage`); the SSE
// 'usage' event (published after every AI completion) and 'billing' event (tier change)
// invalidate it, so the nav counter updates live with no manual refresh. board 0055.
export type Credit = { tier: string; allowanceUsd: number; spentUsd: number; remainingUsd: number }
export type UsageStats = {
	total: { tokens: number; costUsd: number }
	week: { tokens: number; costUsd: number }
	credit?: Credit
}

const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

/** queryFn for `qk.usage`. Returns null when unconfigured / signed out. */
export async function fetchUsage(): Promise<UsageStats | null> {
	if (!BASE) return null
	const token = getBearerToken()
	if (!token) return null
	const res = await fetch(`${BASE}/api/ai/usage`, {
		credentials: 'include',
		headers: { Authorization: `Bearer ${token}` }
	})
	if (!res.ok) return null
	return (await res.json()) as UsageStats
}
