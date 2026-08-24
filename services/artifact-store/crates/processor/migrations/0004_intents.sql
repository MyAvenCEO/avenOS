CREATE SCHEMA IF NOT EXISTS aven_intents;

CREATE TABLE IF NOT EXISTS aven_intents.intents (
    id uuid PRIMARY KEY,
    scope_id uuid NOT NULL,
    declaration_artifact_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
    routing_summary text NOT NULL CHECK (char_length(routing_summary) BETWEEN 1 AND 1024),
    state text NOT NULL DEFAULT 'working' CHECK (state IN ('working', 'waiting', 'done', 'error', 'archive')),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (scope_id, declaration_artifact_id),
    UNIQUE (scope_id, source_artifact_id),
    FOREIGN KEY (scope_id, declaration_artifact_id) REFERENCES artifact_store.artifact_records(scope_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (scope_id, source_artifact_id) REFERENCES artifact_store.artifact_records(scope_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS aven_intents.contributions (
    id uuid PRIMARY KEY,
    intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE CASCADE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    contributor_kind text NOT NULL CHECK (contributor_kind IN ('human', 'agent', 'file-skill', 'system')),
    kind text NOT NULL,
    text text,
    payload jsonb NOT NULL DEFAULT '{}',
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (intent_id, sequence),
    UNIQUE (intent_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS aven_intents.artifacts (
    intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE CASCADE,
    artifact_id uuid NOT NULL,
    scope_id uuid NOT NULL,
    relation text NOT NULL CHECK (relation IN ('source', 'file-skill-output')),
    type_key text NOT NULL,
    type_version integer NOT NULL CHECK (type_version > 0),
    stage_key text,
    display_order bigint NOT NULL CHECK (display_order >= 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (intent_id, artifact_id),
    FOREIGN KEY (scope_id, artifact_id) REFERENCES artifact_store.artifact_records(scope_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS aven_intents.file_skills (
    intent_id uuid PRIMARY KEY REFERENCES aven_intents.intents(id) ON DELETE CASCADE,
    case_id uuid REFERENCES aven_processing.processing_cases(id) ON DELETE SET NULL,
    state text NOT NULL CHECK (state IN ('waiting', 'active', 'succeeded', 'needs_review', 'failed')),
    projection_version text,
    presentation jsonb,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS intents_scope_updated_idx ON aven_intents.intents(scope_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS intent_contributions_sequence_idx ON aven_intents.contributions(intent_id, sequence);
CREATE INDEX IF NOT EXISTS intent_artifacts_order_idx ON aven_intents.artifacts(intent_id, display_order, artifact_id);
