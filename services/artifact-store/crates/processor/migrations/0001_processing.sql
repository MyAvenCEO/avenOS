CREATE SCHEMA IF NOT EXISTS aven_processing;

CREATE TABLE IF NOT EXISTS aven_processing.schema_migrations (
    version integer PRIMARY KEY,
    checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_cases (
    id uuid PRIMARY KEY,
    scope_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    trigger_key text NOT NULL UNIQUE,
    plan_key text NOT NULL,
    plan_version text NOT NULL,
    state text NOT NULL CHECK (state IN ('active', 'succeeded', 'failed', 'needs_review')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (scope_id, source_artifact_id, trigger_key),
    FOREIGN KEY (scope_id, source_artifact_id)
        REFERENCES artifact_store.artifact_records(scope_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_steps (
    id uuid PRIMARY KEY,
    case_id uuid NOT NULL REFERENCES aven_processing.processing_cases(id) ON DELETE CASCADE,
    step_key text NOT NULL,
    procedure_key text NOT NULL,
    publication_id uuid NOT NULL UNIQUE,
    state text NOT NULL CHECK (state IN ('pending', 'queued', 'running', 'publishing', 'retry_wait', 'succeeded', 'failed', 'skipped', 'needs_review', 'unsupported')),
    input_artifact_ids uuid[] NOT NULL DEFAULT '{}',
    parameters jsonb NOT NULL DEFAULT '{}',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    active_attempt_id uuid,
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    terminal_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (case_id, step_key)
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_step_dependencies (
    step_id uuid NOT NULL REFERENCES aven_processing.processing_steps(id) ON DELETE CASCADE,
    dependency_step_id uuid NOT NULL REFERENCES aven_processing.processing_steps(id) ON DELETE CASCADE,
    PRIMARY KEY (step_id, dependency_step_id),
    CHECK (step_id <> dependency_step_id)
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_attempts (
    id uuid PRIMARY KEY,
    step_id uuid NOT NULL REFERENCES aven_processing.processing_steps(id) ON DELETE CASCADE,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    fencing_token uuid NOT NULL,
    lease_expires_at timestamptz NOT NULL,
    state text NOT NULL CHECK (state IN ('running', 'completed', 'expired', 'failed')),
    error_code text,
    error_message text,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at timestamptz,
    UNIQUE (step_id, attempt_number),
    UNIQUE (step_id, fencing_token)
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_outbox (
    id uuid PRIMARY KEY,
    step_id uuid NOT NULL UNIQUE REFERENCES aven_processing.processing_steps(id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL REFERENCES aven_processing.processing_attempts(id) ON DELETE RESTRICT,
    publication_id uuid NOT NULL UNIQUE,
    submission jsonb NOT NULL,
    state text NOT NULL CHECK (state IN ('pending', 'publishing', 'acknowledged', 'failed')),
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_outbox_blobs (
    outbox_id uuid NOT NULL REFERENCES aven_processing.processing_outbox(id) ON DELETE CASCADE,
    local_key text NOT NULL,
    claim_id uuid NOT NULL UNIQUE,
    media_type text NOT NULL,
    bytes bytea NOT NULL,
    PRIMARY KEY (outbox_id, local_key)
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_acknowledgements (
    outbox_id uuid PRIMARY KEY REFERENCES aven_processing.processing_outbox(id) ON DELETE CASCADE,
    result jsonb NOT NULL,
    acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_step_outputs (
    step_id uuid NOT NULL REFERENCES aven_processing.processing_steps(id) ON DELETE CASCADE,
    local_key text NOT NULL,
    artifact_id uuid NOT NULL,
    type_key text NOT NULL,
    type_version integer NOT NULL CHECK (type_version > 0),
    payload jsonb NOT NULL,
    PRIMARY KEY (step_id, local_key),
    UNIQUE (artifact_id)
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_feed_cursors (
    scope_id uuid PRIMARY KEY,
    store_epoch uuid NOT NULL,
    after_sequence bigint NOT NULL DEFAULT 0 CHECK (after_sequence >= 0),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS aven_processing.processing_presentations (
    case_id uuid PRIMARY KEY REFERENCES aven_processing.processing_cases(id) ON DELETE CASCADE,
    source_artifact_id uuid NOT NULL UNIQUE,
    projection_version text NOT NULL,
    presentation jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS processing_steps_claim_idx
    ON aven_processing.processing_steps(state, available_at, created_at);
CREATE INDEX IF NOT EXISTS processing_steps_case_idx
    ON aven_processing.processing_steps(case_id, step_key);
CREATE INDEX IF NOT EXISTS processing_outputs_case_idx
    ON aven_processing.processing_step_outputs(step_id, type_key);

CREATE OR REPLACE FUNCTION aven_processing.reject_attempt_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id <> OLD.id OR NEW.step_id <> OLD.step_id OR NEW.attempt_number <> OLD.attempt_number
       OR NEW.fencing_token <> OLD.fencing_token OR NEW.started_at <> OLD.started_at THEN
        RAISE EXCEPTION 'processing attempt identity is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_attempt_identity_mutation ON aven_processing.processing_attempts;
CREATE TRIGGER reject_attempt_identity_mutation
BEFORE UPDATE ON aven_processing.processing_attempts
FOR EACH ROW EXECUTE FUNCTION aven_processing.reject_attempt_identity_mutation();
