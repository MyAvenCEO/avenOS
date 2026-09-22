CREATE TABLE aven_productivity.tasks (
  id uuid PRIMARY KEY,
  owner_subject_id uuid NOT NULL,
  intent_id uuid,
  revision integer NOT NULL CHECK (revision > 0),
  archived boolean NOT NULL DEFAULT false,
  record jsonb NOT NULL CHECK (jsonb_typeof(record)='object' AND pg_column_size(record) <= 16384),
  UNIQUE(id, owner_subject_id),
  CHECK (record->>'id'=id::text AND record->>'ownerSubjectId'=owner_subject_id::text
    AND (record->>'revision')::integer=revision AND (record->>'archived')::boolean=archived)
);
CREATE INDEX tasks_owner ON aven_productivity.tasks(owner_subject_id,archived,id);
CREATE INDEX tasks_intent ON aven_productivity.tasks(owner_subject_id,intent_id,id);

CREATE TABLE aven_productivity.task_commands (
  owner_subject_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  material_digest text NOT NULL CHECK (material_digest ~ '^[a-f0-9]{64}$'),
  cause jsonb NOT NULL,
  receipt jsonb NOT NULL CHECK (pg_column_size(receipt) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(owner_subject_id,operation_id)
);
CREATE TABLE aven_productivity.task_revisions (
  task_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  owner_subject_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY(task_id,revision),
  FOREIGN KEY(task_id,owner_subject_id) REFERENCES aven_productivity.tasks(id,owner_subject_id),
  FOREIGN KEY(owner_subject_id,operation_id) REFERENCES aven_productivity.task_commands(owner_subject_id,operation_id)
);
