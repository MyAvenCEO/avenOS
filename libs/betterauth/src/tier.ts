// Tier rank order — the SSOT for "is tier X at least tier Y". Pure (no env/db/auth imports),
// so it's safe to load from a unit test and from billing.ts (which can't be loaded with its
// auth side-effects). board 0052/0055.
export const TIER_RANK: Record<string, number> = {
	free: 0,
	avenME: 1,
	avenFOUNDER: 2,
	avenCEO: 3
}

export function meetsTier(userTier: string | null | undefined, minTier: string): boolean {
	const userRank = TIER_RANK[userTier ?? ''] ?? 0
	const minRank = TIER_RANK[minTier] ?? Number.POSITIVE_INFINITY
	return userRank >= minRank
}
