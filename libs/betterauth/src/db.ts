import type { Generated } from 'kysely'
import { Kysely } from 'kysely'
import { NeonDialect } from 'kysely-neon'

/**
 * Shared Kysely instance for OUR tables (token usage + model pricing). Better Auth keeps
 * its own dialect for its 4 tables; this is a separate connection for the app's queries
 * and the Kysely migrations under `migrations/`. board 0051.
 */
export interface AiUsageTable {
	id: string
	user_id: string
	model: string
	prompt_tokens: number
	completion_tokens: number
	total_tokens: number
	cost_usd: number
	created_at: Generated<Date>
}

export interface ModelPricingTable {
	model: string
	input_usd_per_mtok: number
	output_usd_per_mtok: number
	request_usd: number
	updated_at: Generated<Date>
}

export interface AiChatSessionTable {
	id: string
	user_id: string
	title: string
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export interface AiMessageTable {
	id: string
	session_id: string
	role: string
	content: string
	created_at: Generated<Date>
}

export interface Database {
	ai_usage: AiUsageTable
	model_pricing: ModelPricingTable
	ai_chat_session: AiChatSessionTable
	ai_message: AiMessageTable
}

let cached: Kysely<Database> | null = null

export function db(): Kysely<Database> {
	if (!cached) {
		const connectionString = process.env.NEON_PG_KEY
		if (!connectionString) throw new Error('[betterauth] missing env NEON_PG_KEY')
		cached = new Kysely<Database>({ dialect: new NeonDialect({ connectionString }) })
	}
	return cached
}
