import { writable } from 'svelte/store'
import { getBearerToken } from '$lib/auth/auth-client'

// Shared AI usage + credit state so the shell nav can show "credits left" while the chat
// triggers refreshes after each completion. board 0054.
export type Credit = { tier: string; allowanceUsd: number; spentUsd: number; remainingUsd: number }
export type UsageStats = {
	total: { tokens: number; costUsd: number }
	week: { tokens: number; costUsd: number }
	credit?: Credit
}

export const usage = writable<UsageStats | null>(null)

const BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

export async function refreshUsage(): Promise<void> {
	if (!BASE) return
	const token = getBearerToken()
	if (!token) return
	try {
		const res = await fetch(`${BASE}/api/ai/usage`, {
			credentials: 'include',
			headers: { Authorization: `Bearer ${token}` }
		})
		if (res.ok) usage.set((await res.json()) as UsageStats)
	} catch {
		/* leave last value on failure */
	}
}
