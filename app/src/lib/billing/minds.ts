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

// The weekly MINDS a tier's price buys, for the pricing cards. The PRICE is live from Polar; this
// only applies the fixed €→allowance fraction (mirrors the server's credits.ts ALLOWANCE_FRACTION),
// so a Polar repricing flows straight through to the MINDS shown. board 0052.
const WEEKLY_ALLOWANCE_FRACTION = 0.5
export function weeklyMindsLabel(priceEur: number): string {
	return fmtMinds(priceEur * WEEKLY_ALLOWANCE_FRACTION)
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

/**
 * Format a USD amount as the EXACT MINDS consumed, never collapsing tiny values to "<0.01".
 * Per-request costs are minuscule (e.g. 0.00003 MINDS), so small amounts show 3 significant
 * digits (0.0000345 → "0.0000345"); amounts ≥ 1 show up to 2 decimals (12.5 → "12.5"). For the
 * Usage view, where the real cost per roundtrip matters. board 0055.
 */
export function fmtMindsExact(usd: number, locale?: string): string {
	const minds = usd * MINDS_PER_USD
	if (minds === 0) return `0 MINDS`
	const opts: Intl.NumberFormatOptions =
		minds >= 1 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 3 }
	return `${minds.toLocaleString(locale, opts)} MINDS`
}
