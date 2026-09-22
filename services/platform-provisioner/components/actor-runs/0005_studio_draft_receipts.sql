-- One exact draft snapshot per pending Chat invocation. Inserted in the same
-- transaction as its CAS edit, never inferred from a later mutable draft head.
CREATE TABLE aven_actor_runs.studio_draft_receipts (
    invocation_id uuid PRIMARY KEY REFERENCES aven_actor_runs.run_steps(invocation_id) ON DELETE RESTRICT,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text) <= 2097152),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
