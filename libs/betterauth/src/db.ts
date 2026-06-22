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

// Partial view of Better Auth's user table — only the columns we read/write directly
// (tier for product tiers, role for admin). Better Auth owns the full schema.
export interface UserTable {
	id: string
	email: string
	role: string | null
	tier: string | null
	polarLinked: boolean | null
}

// Generic schema-driven data (board 0053). JSONB columns are typed `unknown`; writes
// pass JS objects (the driver serializes), reads come back as parsed objects.
export interface DataSchemaTable {
	id: string
	user_id: string
	name: string
	json_schema: unknown
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export interface DataValueTable {
	id: string
	user_id: string
	schema_id: string
	data: unknown
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export type DataHistoryOperation = 'UPDATE' | 'DELETE'

export interface DataSchemaHistoryTable {
	history_id: Generated<number>
	history_operation: DataHistoryOperation
	history_at: Generated<Date>
	id: string
	user_id: string
	name: string
	json_schema: unknown
	created_at: Date
	updated_at: Date
}

export interface DataValueHistoryTable {
	history_id: Generated<number>
	history_operation: DataHistoryOperation
	history_at: Generated<Date>
	id: string
	user_id: string
	schema_id: string
	data: unknown
	created_at: Date
	updated_at: Date
}

// Append-only audit log of verified Polar webhook events (board 0052). The UI reads billing
// state live from Polar; this is purely for audit / idempotency / replay.
export interface PolarEventTable {
	event_id: string
	type: string
	external_id: string | null
	payload: unknown
	received_at: Generated<Date>
}

// E2EE secrets vault (board 0055). One vault per user; the master DEK is AES-GCM-wrapped under
// the passkey-PRF-derived KEK (HKDF) with a PINNED salt. The server is BLIND: it only ever
// stores ciphertext + wrapped key + salt + nonces — never the token, DEK, KEK, or PRF.
export interface VaultTable {
	id: string
	user_id: string
	credential_id: string
	prf_salt: string
	wrapped_master_key: string
	wrap_nonce: string
	alg: string
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

export interface SecretTable {
	id: string
	vault_id: string
	user_id: string
	kind: string
	label: string | null
	ciphertext: string
	nonce: string
	alg: string
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

// Inbound email received via the Postmark inbound webhook (POST /webhooks/inbox/mail). We store the
// parsed headline fields for querying PLUS the full raw MIME (`raw_email`) and the entire Postmark
// JSON (`payload`) so nothing is lost. Deduped on Postmark's `message_id`. board 0060.
export interface InboundEmailTable {
	id: string
	message_id: string | null
	from_email: string | null
	from_name: string | null
	to_email: string | null
	subject: string | null
	text_body: string | null
	html_body: string | null
	mailbox_hash: string | null
	raw_email: string | null
	payload: unknown
	received_at: Generated<Date>
}

export interface Database {
	ai_usage: AiUsageTable
	inbound_email: InboundEmailTable
	model_pricing: ModelPricingTable
	ai_chat_session: AiChatSessionTable
	ai_message: AiMessageTable
	user: UserTable
	data_schema: DataSchemaTable
	data_value: DataValueTable
	data_schema_history: DataSchemaHistoryTable
	data_value_history: DataValueHistoryTable
	polar_event: PolarEventTable
	vault: VaultTable
	secret: SecretTable
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
