-- Only the fenced worker may write engine checkpoints. API readers see progress
-- through authorized run receipts, not through this internal execution journal.
ALTER TABLE aven_actor_runs.runs ADD COLUMN journal_engine text;
ALTER TABLE aven_actor_runs.runs ADD COLUMN journal_started_at timestamptz;
ALTER TABLE aven_actor_runs.runs ADD COLUMN execution_owner uuid;
ALTER TABLE aven_actor_runs.runs ADD COLUMN journal_resuming boolean NOT NULL DEFAULT false;
CREATE TABLE aven_actor_runs.run_steps (
    run_id uuid NOT NULL REFERENCES aven_actor_runs.runs(id) ON DELETE RESTRICT,
    ordinal integer NOT NULL CHECK (ordinal >= 0 AND ordinal < 256),
    invocation_id uuid NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('model', 'tool', 'outcome')),
    material_digest text NOT NULL CHECK (material_digest ~ '^[a-f0-9]{64}$'),
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'complete')),
    value jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    PRIMARY KEY (run_id, ordinal),
    CHECK ((state='pending' AND value IS NULL AND completed_at IS NULL) OR
           (state='complete' AND value IS NOT NULL AND completed_at IS NOT NULL)),
    CHECK (value IS NULL OR octet_length(value::text) <= 4194304)
);
-- The API status boundary may read this boolean, never the private checkpoint
-- payloads. The view owner resolves the journal while the API gets SELECT only.
CREATE VIEW aven_actor_runs.run_settlement WITH (security_barrier=true) AS
SELECT r.id AS run_id, EXISTS (
    SELECT 1 FROM aven_actor_runs.run_steps s
    WHERE s.run_id=r.id AND s.kind='tool' AND s.state<>'complete'
) AS pending_tool FROM aven_actor_runs.runs r;
