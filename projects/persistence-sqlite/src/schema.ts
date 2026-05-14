export const SQLITE_PRAGMAS = [
	'PRAGMA journal_mode = WAL;',
	'PRAGMA foreign_keys = ON;',
	'PRAGMA busy_timeout = 5000;'
] as const

export const SQLITE_SCHEMA = [
	`CREATE TABLE IF NOT EXISTS actors (
	  id TEXT PRIMARY KEY,
	  kind TEXT NOT NULL,
	  status TEXT NOT NULL CHECK (status IN ('active', 'stopped', 'failed')),
	  state_json TEXT NOT NULL DEFAULT '{}',
	  version INTEGER NOT NULL DEFAULT 0,
	  created_at TEXT NOT NULL,
	  updated_at TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS envelopes (
	  id TEXT PRIMARY KEY,
	  from_actor TEXT NOT NULL,
	  to_actor TEXT NOT NULL,
	  type TEXT NOT NULL,
	  correlation_id TEXT NOT NULL,
	  causation_id TEXT,
	  payload_json TEXT NOT NULL,
	  status TEXT NOT NULL CHECK (status IN ('queued','processing','done','failed','dead')),
	  available_at TEXT NOT NULL,
	  attempts INTEGER NOT NULL DEFAULT 0,
	  max_attempts INTEGER NOT NULL DEFAULT 5,
	  locked_by TEXT,
	  locked_until TEXT,
	  last_error TEXT,
	  created_at TEXT NOT NULL,
	  updated_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS envelopes_claim_idx
	ON envelopes(status, available_at, to_actor, created_at);`,
	`CREATE TABLE IF NOT EXISTS actor_locks (
	  actor_id TEXT PRIMARY KEY,
	  envelope_id TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
	  locked_by TEXT NOT NULL,
	  locked_until TEXT NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS actor_events (
	  id TEXT PRIMARY KEY,
	  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
	  envelope_id TEXT REFERENCES envelopes(id),
	  event_type TEXT NOT NULL,
	  event_json TEXT NOT NULL,
	  created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS actor_events_actor_idx
	ON actor_events(actor_id, created_at);`,
	`CREATE TABLE IF NOT EXISTS stream_events (
	  seq INTEGER PRIMARY KEY AUTOINCREMENT,
	  id TEXT NOT NULL UNIQUE,
	  scope TEXT NOT NULL,
	  actor_id TEXT,
	  envelope_id TEXT,
	  type TEXT NOT NULL,
	  payload_json TEXT NOT NULL,
	  created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS stream_events_scope_seq_idx
	ON stream_events(scope, seq);`,
	`CREATE TABLE IF NOT EXISTS context_items (
	  seq INTEGER PRIMARY KEY AUTOINCREMENT,
	  id TEXT NOT NULL UNIQUE,
	  scope_type TEXT NOT NULL CHECK (scope_type IN ('run','intent','call','actor','global')),
	  scope_key TEXT NOT NULL,
	  correlation_id TEXT NOT NULL,
	  intent_id TEXT,
	  actor_id TEXT NOT NULL,
	  call_id TEXT,
	  parent_call_id TEXT,
	  root_call_id TEXT,
	  kind TEXT NOT NULL,
	  key TEXT,
	  schema TEXT,
	  tags_json TEXT NOT NULL DEFAULT '[]',
	  body_json TEXT,
	  artifact_id TEXT,
	  summary TEXT,
	  produced_by_actor_id TEXT NOT NULL,
	  produced_by_envelope_id TEXT NOT NULL,
	  produced_by_command_id TEXT,
	  produced_by_tool_call_id TEXT,
	  source_context_item_ids_json TEXT NOT NULL DEFAULT '[]',
	  confidence REAL,
	  hash TEXT NOT NULL,
	  supersedes_item_id TEXT,
	  redacts_item_id TEXT,
	  created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS context_items_scope_seq_idx
	ON context_items(scope_type, scope_key, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_correlation_idx
	ON context_items(correlation_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_intent_idx
	ON context_items(intent_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_call_idx
	ON context_items(root_call_id, call_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_actor_idx
	ON context_items(actor_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_kind_key_idx
	ON context_items(kind, key, seq);`,
	`CREATE TABLE IF NOT EXISTS skills (
	  id TEXT PRIMARY KEY,
	  path TEXT NOT NULL UNIQUE,
	  frontmatter_json TEXT NOT NULL,
	  body TEXT NOT NULL,
	  body_hash TEXT NOT NULL,
	  loaded_at TEXT NOT NULL
	);`
] as const