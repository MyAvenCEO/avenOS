CREATE TABLE IF NOT EXISTS aven_processing.processor_scopes (
    scope_id uuid PRIMARY KEY,
    provisioned_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
