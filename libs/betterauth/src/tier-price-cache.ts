// Shared, mutable cache of live tier prices (EUR/week), populated from Polar by billing.ts and
// read by credits.ts (MINDS allowance) + billingState (UI). A separate tiny module so neither
// billing nor credits has to import the other (no cycle). Polar is the pricing SSOT; this is just
// a hot-path cache so we don't hit the Polar API on every credit check / state read. board 0052.
const cache = new Map<string, number>()

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
