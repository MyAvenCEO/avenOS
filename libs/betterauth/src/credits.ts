import { sql } from 'kysely'
import { db } from './db'
import { getTierPriceEur } from './tier-price-cache'

// Fallback weekly price of each tier, in EUR — used only until billing.ts has read the LIVE price
// from Polar (the SSOT) into the shared cache. Drives the MINDS allowance (price × ALLOWANCE_FRACTION).
// board 0052.
export const TIER_PRICE_EUR: Record<string, number> = {
	free: 0,
	avenME: 7,
	avenFOUNDER: 34,
	avenCEO: 377
}

/** A tier's weekly price in EUR: the live Polar price when cached, else the hardcoded fallback. */
function tierPriceEur(tier: string): number {
	return getTierPriceEur(tier) ?? TIER_PRICE_EUR[tier] ?? 0
}

// We grant HALF the tier's weekly price as the AI credit allowance. This €-price → $-allowance
// rule lives HERE, deliberately separate from the $ → MINDS display ratio
// (app/src/lib/billing/minds.ts). Internal accounting stays in USD; the frontend shows MINDS.
// (The € figure is treated 1:1 as the USD basis for now — a real FX rate would slot in here.)
export const ALLOWANCE_FRACTION = 0.5

// Free / comp tiers grant a FIXED weekly allowance (not derived from a Polar price). `early-bird`
// is the early-adopter comp role an admin grants: 10 MINDS/week of usage (1 USD = 10 MINDS, see
// app/src/lib/billing/minds.ts). board 0055.
export const FIXED_ALLOWANCE_USD: Record<string, number> = {
	'early-bird': 1 // 10 MINDS
}

export function weeklyAllowanceUsd(tier: string): number {
	const fixed = FIXED_ALLOWANCE_USD[tier]
	if (fixed !== undefined) return fixed
	return tierPriceEur(tier) * ALLOWANCE_FRACTION
}

export type CreditStatus = {
	tier: string
	allowanceUsd: number
	spentUsd: number
	remainingUsd: number
}

/** The user's current tier (read fresh from the DB so admin changes take effect at once). */
export async function tierOf(userId: string): Promise<string> {
	const row = await db()
		.selectFrom('user')
		.select('tier')
		.where('id', '=', userId)
		.executeTakeFirst()
	return row?.tier ?? 'free'
}

/** Weekly credit status for a user: allowance (by tier), spent this week, remaining. */
export async function creditStatus(userId: string): Promise<CreditStatus> {
	const tier = await tierOf(userId)
	const allowanceUsd = weeklyAllowanceUsd(tier)
	const spentRow = await db()
		.selectFrom('ai_usage')
		.select(({ fn }) => fn.sum('cost_usd').as('cost'))
		.where('user_id', '=', userId)
		.where('created_at', '>=', sql<Date>`date_trunc('week', now())`)
		.executeTakeFirst()
	const spentUsd = Number(spentRow?.cost ?? 0)
	return { tier, allowanceUsd, spentUsd, remainingUsd: Math.max(0, allowanceUsd - spentUsd) }
}
