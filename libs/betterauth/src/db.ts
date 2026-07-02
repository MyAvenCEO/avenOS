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
	// board 0100 — a predication IS its predicate + x1–x5 cells, so those are real columns now
	// (only Lojban x1–x5 predications are legal; the shape is enforced by the DB, not a jsonb blob).
	// `data` is kept transitionally (nullable) but no longer written; the columns are the SSOT.
	predicate: string | null
	x1: string | null
	x2: string | null
	x3: string | null
	x4: string | null
	x5: string | null
	data: unknown
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

// Flow/skill CONFIG templates (board 0087, Layer A). System structure — admin-owned CRUD,
// seeded from @avenos/aven-skills EXAMPLE_FLOWS by a migration. NOT user data: distinct from
// the dynamic data_schema/data_value store. Columns mirror the `Flow` type; node/edge graphs
// are JSONB. See [[two-layer-schema-split]].
export interface FlowTable {
	id: string
	name: string
	description: string
	nodes: unknown
	edges: unknown
	triggers: unknown
	resource_labels: unknown
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

// BUNDLE registry (board 0088/0102) — `data_bundles`, in the dynamic-data namespace. Each row is a
// declarative bundle spec (an aven-ontology Bundle/TypeSpec): which predicates cluster into a kind + how
// they read back flat. The generic engine loads it at runtime, so there is NO per-type code. A bundle is
// AI-mintable at runtime like a predicate is, so it belongs beside data_schema/data_value, not with the
// admin `flow` config. See [[two-layer-schema-split]].
export interface DataBundlesTable {
	type: string
	spec: unknown
	created_at: Generated<Date>
	updated_at: Generated<Date>
}

// Content-addressed raw-artifact store (board 0089) — original source bytes for any ingesting skill,
// keyed by sha256 (bytea). Behind the abstracted ArtifactStore; only the hash enters the predications.
export interface ArtifactTable {
	sha256: string
	bytes: unknown
	mime: string
	size: number
	created_at: Generated<Date>
}

// Persisted skill RUN traces (board 0089) — the FlowRun event-log from the generic runner, per user.
export interface FlowRunTable {
	id: string
	user_id: string
	flow_id: string
	label: string
	status: string
	trace: unknown
	started_at: Date | null
	created_at: Generated<Date>
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
	flow: FlowTable
	data_bundles: DataBundlesTable
	artifact: ArtifactTable
	flow_run: FlowRunTable
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
