-- Rebuildable search projections. Source text remains in the owning rows.
CREATE FUNCTION aven_intents.search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path = pg_catalog
AS $$ SELECT replace(regexp_replace(lower(normalize(value, NFKD)), U&'[\0300-\036f]', '', 'g'), 'ß', 'ss') $$;

CREATE TABLE aven_intents.intents (
    id uuid PRIMARY KEY,
    owner_subject_id uuid NOT NULL,
    trigger_kind text NOT NULL CHECK (trigger_kind IN ('human', 'agent', 'skill', 'system')),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 512),
    intent_type text NOT NULL DEFAULT 'intent' CHECK (char_length(intent_type) BETWEEN 1 AND 128),
    source_label text NOT NULL DEFAULT 'Conversation' CHECK (char_length(source_label) BETWEEN 1 AND 256),
    deadline text CHECK (deadline IS NULL OR char_length(deadline) BETWEEN 1 AND 128),
    routing_summary text NOT NULL CHECK (char_length(routing_summary) BETWEEN 1 AND 1024),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, aven_intents.search_normalize(
        id::text || ' ' || title || ' ' || intent_type || ' ' || source_label || ' ' || routing_summary
    ))) STORED,
    state text NOT NULL DEFAULT 'working' CHECK (state IN ('working', 'waiting', 'done', 'error', 'archive', 'merged', 'deleted')),
    state_before_archive text CHECK (state_before_archive IS NULL OR state_before_archive IN ('working', 'waiting', 'done', 'error')),
    merged_into_id uuid REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE aven_intents.contributions (
    id uuid PRIMARY KEY,
    intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
    owner_subject_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    contributor_kind text NOT NULL CHECK (contributor_kind IN ('human', 'agent', 'skill', 'system')),
    kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
    text text CHECK (text IS NULL OR char_length(text) <= 100000),
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig,
        aven_intents.search_normalize(COALESCE(text,'')))) STORED,
    payload jsonb NOT NULL DEFAULT '{}',
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (intent_id, sequence),
    UNIQUE (intent_id, idempotency_key)
);

CREATE TABLE aven_intents.merge_commands (
	command_id uuid PRIMARY KEY,
	target_intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
	target_version bigint NOT NULL CHECK (target_version > 0),
	source_versions jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE aven_intents.merge_relations (
    target_intent_id uuid NOT NULL REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
    source_intent_id uuid NOT NULL UNIQUE REFERENCES aven_intents.intents(id) ON DELETE RESTRICT,
	command_id uuid NOT NULL REFERENCES aven_intents.merge_commands(command_id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (target_intent_id, source_intent_id),
    CHECK (target_intent_id <> source_intent_id)
);

CREATE FUNCTION aven_intents.contribution_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  SELECT owner_subject_id INTO NEW.owner_subject_id FROM aven_intents.intents WHERE id=NEW.intent_id;
  RETURN NEW;
END $$;
CREATE TRIGGER contribution_owner BEFORE INSERT OR UPDATE ON aven_intents.contributions
FOR EACH ROW EXECUTE FUNCTION aven_intents.contribution_owner();

CREATE INDEX intents_search_idx ON aven_intents.intents USING gin(search_vector)
WHERE state NOT IN ('merged','deleted');
CREATE INDEX intents_owner_page_idx ON aven_intents.intents(owner_subject_id, updated_at DESC, id DESC)
WHERE state NOT IN ('merged','deleted');
CREATE INDEX intents_owner_id_idx ON aven_intents.intents(owner_subject_id, id)
WHERE state NOT IN ('merged','deleted');

CREATE INDEX contributions_search_idx ON aven_intents.contributions USING gin(search_vector)
WHERE contributor_kind IN ('human','agent') AND text IS NOT NULL;
CREATE INDEX contributions_owner_id_idx ON aven_intents.contributions(owner_subject_id,id)
WHERE contributor_kind IN ('human','agent') AND text IS NOT NULL;
