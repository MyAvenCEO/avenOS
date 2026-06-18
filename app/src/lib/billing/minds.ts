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

/**
 * Format a USD amount as MINDS for display: 3.5 → "35 MINDS", 0.12 → "0.12 MINDS".
 * A tiny non-zero amount shows "<0.01 MINDS" rather than rounding to 0.
 */
export function fmtMinds(usd: number): string {
	const minds = usd * MINDS_PER_USD
	if (minds > 0 && minds < 0.01) return '<0.01 MINDS'
	const n = minds >= 100 ? Math.round(minds) : Number(minds.toFixed(2))
	return `${n.toLocaleString()} MINDS`
}
