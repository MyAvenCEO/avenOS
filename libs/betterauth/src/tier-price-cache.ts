// Shared, mutable cache of live tier prices (EUR/week), populated from Polar by billing.ts and
// read by credits.ts (MINDS allowance) + billingState (UI). A separate tiny module so neither
// billing nor credits has to import the other (no cycle). Polar is the pricing SSOT; this is just
// a hot-path cache so we don't hit the Polar API on every credit check / state read. board 0052.
const cache = new Map<string, number>()
const benefitCache = new Map<string, string[]>()

/** Store a tier's live weekly price in EUR (called after fetching the Polar product). */
export function setTierPriceEur(tier: string, eur: number): void {
	cache.set(tier, eur)
}

/** The cached live price for a tier in EUR, or undefined if Polar hasn't been read yet. */
export function getTierPriceEur(tier: string): number | undefined {
	return cache.get(tier)
}

/** Snapshot of all cached tier prices (EUR) for the UI. */
export function allTierPricesEur(): Record<string, number> {
	return Object.fromEntries(cache)
}

/** Store a tier's live benefit descriptions (from its Polar product), in display order. */
export function setTierBenefits(tier: string, benefits: string[]): void {
	benefitCache.set(tier, benefits)
}

/** Snapshot of all cached tier benefit lists for the UI (Polar is the SSOT). */
export function allTierBenefits(): Record<string, string[]> {
	return Object.fromEntries(benefitCache)
}
