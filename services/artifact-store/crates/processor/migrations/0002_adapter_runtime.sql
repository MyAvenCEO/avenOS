CREATE TABLE IF NOT EXISTS aven_processing.model_call_ledger (
    id uuid PRIMARY KEY,
    scope_id uuid NOT NULL,
    request_key char(64) NOT NULL CHECK (request_key ~ '^[0-9a-f]{64}$'),
    procedure_key text NOT NULL,
    contract_version text NOT NULL,
    model_deployment text NOT NULL,
    prompt_digest char(64) NOT NULL CHECK (prompt_digest ~ '^[0-9a-f]{64}$'),
    implementation_digest char(64) NOT NULL CHECK (implementation_digest ~ '^[0-9a-f]{64}$'),
    state text NOT NULL CHECK (state IN ('leased', 'succeeded', 'failed')),
    lease_owner uuid,
    fencing_token uuid,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    structured_result jsonb,
    receipt jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (scope_id, request_key),
    CHECK (
        (state = 'leased' AND lease_owner IS NOT NULL AND fencing_token IS NOT NULL
            AND lease_expires_at IS NOT NULL AND structured_result IS NULL)
        OR (state = 'succeeded' AND structured_result IS NOT NULL AND receipt IS NOT NULL)
        OR (state = 'failed' AND error_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS model_call_ledger_lease_idx
    ON aven_processing.model_call_ledger(state, lease_expires_at);

COMMENT ON TABLE aven_processing.model_call_ledger IS
    'Per-customer exact-request ledger for crash-safe paid model calls; unused by mocks.';
