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

// One row per AI request roundtrip — tokens in/out + the USD cost we snapshotted. The frontend
// renders the cost as MINDS. Read via `qk.usageRecent` (prefix `usage`), so the SSE 'usage' event
// refreshes it live after each completion. board 0055.
export type RecentUsageItem = {
	id: string
	model: string
	promptTokens: number
	completionTokens: number
	totalTokens: number
	costUsd: number
	createdAt: string
}

/** queryFn for `qk.usageRecent`. Returns [] when unconfigured / signed out. */
export async function fetchRecentUsage(): Promise<RecentUsageItem[]> {
	if (!BASE) return []
	const token = getBearerToken()
	if (!token) return []
	const res = await fetch(`${BASE}/api/ai/usage/recent`, {
		credentials: 'include',
		headers: { Authorization: `Bearer ${token}` }
	})
	if (!res.ok) return []
	return ((await res.json()) as { recent: RecentUsageItem[] }).recent
}
