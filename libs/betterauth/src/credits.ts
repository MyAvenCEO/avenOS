import { sql } from 'kysely'
import { db } from './db'

// Per-tier weekly AI credit allowance, in USD. Spend is the sum of ai_usage.cost_usd
// since the start of the current week (Monday, UTC). avenCITY = the first paid tier.
// board 0052.
export const WEEKLY_CREDIT_USD: Record<string, number> = {
	free: 0,
	avenCITY: 3
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
	const allowanceUsd = WEEKLY_CREDIT_USD[tier] ?? 0
	const spentRow = await db()
		.selectFrom('ai_usage')
		.select(({ fn }) => fn.sum('cost_usd').as('cost'))
		.where('user_id', '=', userId)
		.where('created_at', '>=', sql<Date>`date_trunc('week', now())`)
		.executeTakeFirst()
	const spentUsd = Number(spentRow?.cost ?? 0)
	return { tier, allowanceUsd, spentUsd, remainingUsd: Math.max(0, allowanceUsd - spentUsd) }
}
