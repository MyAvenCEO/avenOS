/**
 * MINDS — the native protocol currency. Single source of truth for the $ → MINDS ratio.
 * 1 USD = 10 MINDS. We never show raw dollars in the UI; the server accounts in USD and
 * the frontend converts to MINDS for display. (The separate €-price → $-allowance rule
 * lives server-side in libs/betterauth/src/credits.ts.) board 0052.
 */
export const MINDS_PER_USD = 10

export function usdToMinds(usd: number): number {
	return usd * MINDS_PER_USD
}

/** Format a USD amount as MINDS for display, e.g. 3.5 → "35 MINDS", 0.0012 → "0.01 MINDS". */
export function fmtMinds(usd: number): string {
	const minds = usd * MINDS_PER_USD
	const n = minds >= 100 ? Math.round(minds) : Number(minds.toFixed(2))
	return `${n.toLocaleString()} MINDS`
}
