CREATE SCHEMA IF NOT EXISTS aven_intent_service;

CREATE TABLE IF NOT EXISTS aven_intent_service.schema_migrations (
    version integer PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_intent_service.scopes (
    scope_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_intent_service.feed_cursors (
    scope_id uuid PRIMARY KEY REFERENCES aven_intent_service.scopes(scope_id) ON DELETE CASCADE,
    store_epoch uuid NOT NULL,
    after_sequence bigint NOT NULL DEFAULT 0 CHECK (after_sequence >= 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_intent_service.intents (
    id uuid PRIMARY KEY,
    scope_id uuid NOT NULL REFERENCES aven_intent_service.scopes(scope_id) ON DELETE RESTRICT,
    trigger_kind text NOT NULL CHECK (trigger_kind IN ('file-upload', 'human', 'agent', 'skill', 'system')),
    declaration_artifact_id uuid,
    source_artifact_id uuid,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
    intent_type text NOT NULL DEFAULT 'intent' CHECK (char_length(intent_type) BETWEEN 1 AND 128),
    source_label text NOT NULL DEFAULT 'Conversation' CHECK (char_length(source_label) BETWEEN 1 AND 256),
    deadline text CHECK (deadline IS NULL OR char_length(deadline) BETWEEN 1 AND 128),
    routing_summary text NOT NULL CHECK (char_length(routing_summary) BETWEEN 1 AND 1024),
    state text NOT NULL DEFAULT 'working' CHECK (state IN ('working', 'waiting', 'done', 'error', 'archive', 'merged', 'deleted')),
    state_before_archive text CHECK (state_before_archive IS NULL OR state_before_archive IN ('working', 'waiting', 'done', 'error')),
    merged_into_id uuid REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (scope_id, declaration_artifact_id),
    UNIQUE (scope_id, source_artifact_id),
    CHECK ((trigger_kind = 'file-upload') = (declaration_artifact_id IS NOT NULL AND source_artifact_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS aven_intent_service.contributions (
    id uuid PRIMARY KEY,
    intent_id uuid NOT NULL REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    sequence bigint NOT NULL CHECK (sequence > 0),
    contributor_kind text NOT NULL CHECK (contributor_kind IN ('human', 'agent', 'skill', 'system')),
    kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
    text text CHECK (text IS NULL OR char_length(text) <= 100000),
    payload jsonb NOT NULL DEFAULT '{}',
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (intent_id, sequence),
    UNIQUE (intent_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS aven_intent_service.artifacts (
    intent_id uuid NOT NULL REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    artifact_id uuid NOT NULL,
    relation text NOT NULL CHECK (relation IN ('source', 'file-skill-output', 'attached')),
    type_key text NOT NULL CHECK (char_length(type_key) BETWEEN 1 AND 255),
    type_version integer NOT NULL CHECK (type_version > 0),
    stage_key text,
    display_order bigint NOT NULL CHECK (display_order >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (intent_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS aven_intent_service.file_skills (
    intent_id uuid PRIMARY KEY REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('waiting', 'active', 'succeeded', 'needs_review', 'failed')),
    projection_version text,
    presentation jsonb,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_intent_service.merge_relations (
    target_intent_id uuid NOT NULL REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    source_intent_id uuid NOT NULL UNIQUE REFERENCES aven_intent_service.intents(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (target_intent_id, source_intent_id),
    CHECK (target_intent_id <> source_intent_id)
);

CREATE INDEX IF NOT EXISTS intents_scope_updated_idx ON aven_intent_service.intents(scope_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS intent_contributions_sequence_idx ON aven_intent_service.contributions(intent_id, sequence);
CREATE INDEX IF NOT EXISTS intent_artifacts_order_idx ON aven_intent_service.artifacts(intent_id, display_order, artifact_id);
