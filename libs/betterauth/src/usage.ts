import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'
import { db } from './db'

const TINFOIL_BASE_URL = process.env.TINFOIL_BASE_URL ?? 'https://inference.tinfoil.sh/v1'

export type TokenUsage = {
	prompt_tokens?: number
	completion_tokens?: number
	total_tokens?: number
}

/** Upsert per-model pricing from Tinfoil's /v1/models (it returns input/output $/Mtok). */
export async function syncPricing(): Promise<void> {
	const key = process.env.TINFOIL_API_KEY
	if (!key) return
	const res = await fetch(`${TINFOIL_BASE_URL}/models`, {
		headers: { Authorization: `Bearer ${key}` }
	}).catch(() => null)
	if (!res?.ok) return
	const data = (await res.json().catch(() => null)) as {
		data?: {
			id: string
			pricing?: {
				inputTokenPricePer1M?: number
				outputTokenPricePer1M?: number
				requestPrice?: number
			}
		}[]
	} | null
	for (const m of data?.data ?? []) {
		if (!m.pricing) continue
		const values = {
			input_usd_per_mtok: m.pricing.inputTokenPricePer1M ?? 0,
			output_usd_per_mtok: m.pricing.outputTokenPricePer1M ?? 0,
			request_usd: m.pricing.requestPrice ?? 0,
			updated_at: new Date()
		}
		await db()
			.insertInto('model_pricing')
			.values({ model: m.id, ...values })
			.onConflict((oc) => oc.column('model').doUpdateSet(values))
			.execute()
	}
}

async function priceFor(model: string) {
	let row = await db()
		.selectFrom('model_pricing')
		.selectAll()
		.where('model', '=', model)
		.executeTakeFirst()
	if (!row) {
		// First time we see this model — pull the live price list, then retry once.
		await syncPricing().catch(() => {})
		row = await db()
			.selectFrom('model_pricing')
			.selectAll()
			.where('model', '=', model)
			.executeTakeFirst()
	}
	return row
}

/** Record one completion's token usage for a user, snapshotting the USD cost. */
export async function recordUsage(userId: string, model: string, usage: TokenUsage): Promise<void> {
	const prompt = usage.prompt_tokens ?? 0
	const completion = usage.completion_tokens ?? 0
	const total = usage.total_tokens ?? prompt + completion
	const price = await priceFor(model)
	const cost = price
		? (prompt / 1_000_000) * price.input_usd_per_mtok +
			(completion / 1_000_000) * price.output_usd_per_mtok +
			price.request_usd
		: 0
	await db()
		.insertInto('ai_usage')
		.values({
			id: randomUUID(),
			user_id: userId,
			model,
			prompt_tokens: prompt,
			completion_tokens: completion,
			total_tokens: total,
			cost_usd: cost,
			created_at: new Date()
		})
		.execute()
}

export type UsageStats = {
	total: { tokens: number; costUsd: number }
	week: { tokens: number; costUsd: number }
}

/** Aggregate a user's usage: all-time total + the current week (since Monday, UTC). */
export async function getUsageStats(userId: string): Promise<UsageStats> {
	const agg = (sinceThisWeek: boolean) => {
		let q = db()
			.selectFrom('ai_usage')
			.select(({ fn }) => [fn.sum('total_tokens').as('tokens'), fn.sum('cost_usd').as('cost')])
			.where('user_id', '=', userId)
		if (sinceThisWeek) q = q.where('created_at', '>=', sql<Date>`date_trunc('week', now())`)
		return q.executeTakeFirst()
	}
	const [total, week] = await Promise.all([agg(false), agg(true)])
	return {
		total: { tokens: Number(total?.tokens ?? 0), costUsd: Number(total?.cost ?? 0) },
		week: { tokens: Number(week?.tokens ?? 0), costUsd: Number(week?.cost ?? 0) }
	}
}
