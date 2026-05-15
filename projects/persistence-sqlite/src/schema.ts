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
	  run_id TEXT NOT NULL,
	  caused_by TEXT,
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
	`CREATE TABLE IF NOT EXISTS events (
	  seq INTEGER PRIMARY KEY AUTOINCREMENT,
	  type TEXT NOT NULL,
	  visibility TEXT NOT NULL CHECK (visibility IN ('chat','worklog','debug')),
	  run_id TEXT,
	  intent_id TEXT,
	  actor_id TEXT,
	  envelope_id TEXT,
	  call_id TEXT,
	  parent_seq INTEGER,
	  payload_json TEXT NOT NULL,
	  created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS events_visibility_seq_idx
	ON events(visibility, seq);`,
	`CREATE INDEX IF NOT EXISTS events_run_seq_idx
	ON events(run_id, seq);`,
	`CREATE INDEX IF NOT EXISTS events_intent_seq_idx
	ON events(intent_id, seq);`,
	`CREATE INDEX IF NOT EXISTS events_actor_seq_idx
	ON events(actor_id, seq);`,
	`CREATE INDEX IF NOT EXISTS events_call_seq_idx
	ON events(call_id, seq);`,
	`CREATE TABLE IF NOT EXISTS context_items (
	  seq INTEGER PRIMARY KEY AUTOINCREMENT,
	  kind TEXT NOT NULL,
	  visibility TEXT NOT NULL CHECK (visibility IN ('chat','worklog','debug')),
	  run_id TEXT,
	  intent_id TEXT,
	  actor_id TEXT,
	  envelope_id TEXT,
	  call_id TEXT,
	  key TEXT,
	  summary TEXT,
	  body_json TEXT,
	  artifact_uri TEXT,
	  created_at TEXT NOT NULL
	);`,
	`CREATE INDEX IF NOT EXISTS context_items_run_idx
	ON context_items(run_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_intent_idx
	ON context_items(intent_id, seq);`,
	`CREATE INDEX IF NOT EXISTS context_items_call_idx
	ON context_items(call_id, seq);`,
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
