CREATE TABLE aven_actor_runs.studio_drafts (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  definition jsonb NOT NULL,
  published_artifact_id uuid,
  published_revision integer,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX studio_drafts_subject ON aven_actor_runs.studio_drafts(subject_id, updated_at DESC);

CREATE TABLE aven_actor_runs.studio_connections (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  record jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  store_epoch uuid NOT NULL,
  after_sequence bigint NOT NULL CHECK (after_sequence >= 0),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX studio_connections_subject ON aven_actor_runs.studio_connections(subject_id);

CREATE TABLE aven_actor_runs.studio_deliveries (
  id uuid PRIMARY KEY,
  subject_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES aven_actor_runs.studio_connections(id),
  record jsonb NOT NULL,
  run_id uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX studio_deliveries_pending ON aven_actor_runs.studio_deliveries(subject_id, created_at) WHERE run_id IS NULL;
