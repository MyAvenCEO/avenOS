-- One commit establishes the contribution, its receipt, and runnable delivery.
CREATE TABLE aven_intents.input_admissions (
    owner_subject_id uuid NOT NULL,
    input_id uuid NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    material_digest text NOT NULL CHECK (material_digest ~ '^[a-f0-9]{64}$'),
    intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
    contribution_id uuid NOT NULL UNIQUE REFERENCES aven_intents.contributions(id) ON DELETE RESTRICT,
    turn_id uuid NOT NULL UNIQUE,
    sequence bigint NOT NULL CHECK (sequence > 0),
    intent_title text NOT NULL,
    admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_subject_id, input_id)
);

CREATE TABLE aven_intents.turn_outbox (
    turn_id uuid PRIMARY KEY REFERENCES aven_intents.input_admissions(turn_id) ON DELETE RESTRICT,
    intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
    owner_subject_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    input jsonb NOT NULL,
    routing_generation bigint NOT NULL CHECK (routing_generation > 0),
    work_grant text NOT NULL CHECK (octet_length(work_grant) BETWEEN 1 AND 8192),
    authority_expires_at timestamptz NOT NULL,
    control_revision integer NOT NULL DEFAULT 1 CHECK (control_revision > 0),
    stop_requested_at timestamptz,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatched','completed','failed','cancelled','blocked')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    dispatch_token uuid,
    dispatch_until timestamptz,
    dispatched_at timestamptz,
    run_id uuid UNIQUE,
    context_sequence bigint CHECK (context_sequence IS NULL OR context_sequence > 0),
    output_id uuid NOT NULL UNIQUE,
    finish_digest text CHECK (finish_digest IS NULL OR finish_digest ~ '^[a-f0-9]{64}$'),
    finished_at timestamptz,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (intent_id, sequence)
);
CREATE INDEX turn_outbox_pending ON aven_intents.turn_outbox(available_at, created_at)
WHERE state='pending';
CREATE INDEX turn_outbox_unfinished ON aven_intents.turn_outbox(intent_id, sequence)
WHERE state IN ('pending','dispatched','blocked');

-- State changes and authority withdrawal commit together, including merges and
-- direct updates. Unbound work cannot execute and can be cancelled immediately.
-- Bound work may have an in-flight effect: keep its FIFO barrier after restoration
-- until its outcome is reconciled. Archival is not proof of execution settlement.
CREATE FUNCTION aven_intents.cancel_unavailable_intent_work() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.state IN ('archive','merged','deleted') AND NEW.state IS DISTINCT FROM OLD.state THEN
    UPDATE aven_intents.turn_outbox SET state=CASE WHEN run_id IS NULL THEN 'cancelled' ELSE 'blocked' END,
      error_code=CASE WHEN error_code='EXECUTION_UNCERTAIN' THEN error_code ELSE 'INTENT_UNAVAILABLE' END,
      dispatch_token=NULL, dispatch_until=NULL,
      finished_at=CASE WHEN run_id IS NULL THEN clock_timestamp() ELSE finished_at END
    WHERE intent_id=NEW.id AND state IN ('pending','dispatched','blocked');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cancel_unavailable_intent_work AFTER UPDATE OF state ON aven_intents.intents
FOR EACH ROW EXECUTE FUNCTION aven_intents.cancel_unavailable_intent_work();
