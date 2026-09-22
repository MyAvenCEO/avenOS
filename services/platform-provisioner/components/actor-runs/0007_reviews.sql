-- Review proposals and decisions are private execution records, not artifacts.
-- Workers can propose; only the interactive API role can decide. Neither role
-- can edit the underlying records or turn a continuation value into approval.
CREATE TABLE aven_actor_runs.review_requests (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES aven_actor_runs.runs(id),
  invocation_id text NOT NULL CHECK (length(invocation_id) BETWEEN 1 AND 256),
  revision integer NOT NULL CHECK (revision > 0),
  generation bigint NOT NULL CHECK (generation > 0),
  subject_schema text NOT NULL CHECK (length(subject_schema) BETWEEN 1 AND 256),
  subject_digest text NOT NULL CHECK (subject_digest ~ '^[a-f0-9]{64}$'),
  subject jsonb NOT NULL CHECK (jsonb_typeof(subject)='object' AND octet_length(subject::text)<=32768),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 256),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (run_id, invocation_id, revision)
);
CREATE TABLE aven_actor_runs.review_decisions (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES aven_actor_runs.review_requests(id),
  event_version integer NOT NULL CHECK (event_version > 0),
  reviewer_id uuid NOT NULL,
  session_id text NOT NULL CHECK (length(session_id) BETWEEN 1 AND 256),
  outcome text NOT NULL CHECK (outcome IN ('approve','deny','postpone')),
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (review_id,event_version)
);
REVOKE ALL ON aven_actor_runs.review_requests, aven_actor_runs.review_decisions FROM PUBLIC;

CREATE FUNCTION aven_actor_runs.review_scope(p_environment uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,aven_actor_runs AS $$
BEGIN
  PERFORM 1 FROM aven_platform.environment_identity
    WHERE singleton AND environment_id=p_environment AND routing_generation=p_generation
      AND execution_enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_SCOPE_UNAVAILABLE'; END IF;
END $$;

CREATE FUNCTION aven_actor_runs.review_read(p_environment uuid,p_generation bigint,p_subject uuid,p_run uuid,p_review uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,aven_actor_runs AS $$
DECLARE result jsonb;
BEGIN
  PERFORM review_scope(p_environment,p_generation);
  SELECT jsonb_build_object(
    'id',q.id,'runId',q.run_id,'invocationId',q.invocation_id,'revision',q.revision,
    'generation',q.generation,'subjectSchema',q.subject_schema,'subjectDigest',q.subject_digest,
    'subject',q.subject,'title',q.title,'expiresAt',q.expires_at,'createdAt',q.created_at,
    'superseded',EXISTS(SELECT 1 FROM review_requests n WHERE n.run_id=q.run_id
      AND n.invocation_id=q.invocation_id AND n.revision>q.revision),
    'eventVersion',coalesce(d.event_version,0),
    'decision',CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',d.id,'outcome',d.outcome,'reviewerId',d.reviewer_id,'sessionId',d.session_id,'decidedAt',d.decided_at) END)
  INTO result FROM review_requests q JOIN runs r ON r.id=q.run_id
  LEFT JOIN LATERAL (SELECT * FROM review_decisions WHERE review_id=q.id ORDER BY event_version DESC LIMIT 1) d ON true
  WHERE q.id=p_review AND r.id=p_run AND r.subject_id=p_subject AND q.generation=p_generation;
  IF result IS NULL THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION aven_actor_runs.review_open(p_environment uuid,p_generation bigint,p_subject uuid,p_run uuid,p_owner uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,aven_actor_runs AS $$
DECLARE r runs; old review_requests; next_revision integer; expiry timestamptz;
BEGIN
  -- Match the runner's lock order: run, then physical environment fence.
  SELECT * INTO r FROM runs WHERE id=p_run AND subject_id=p_subject FOR UPDATE;
  IF NOT FOUND OR r.state<>'running' OR r.execution_owner IS DISTINCT FROM p_owner
    OR (r.record->'lease'->>'ownerId') IS DISTINCT FROM p_owner::text
    OR coalesce((r.record->'lease'->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
    THEN RAISE EXCEPTION 'REVIEW_EXECUTION_INACTIVE'; END IF;
  PERFORM review_scope(p_environment,p_generation);
  IF jsonb_typeof(p_request)<>'object' OR NOT(p_request ?& ARRAY['id','invocationId','revision','subjectSchema','subjectDigest','subject','title','expiresAt'])
    OR (p_request-ARRAY['id','invocationId','revision','subjectSchema','subjectDigest','subject','title','expiresAt'])<>'{}'::jsonb
    THEN RAISE EXCEPTION 'REVIEW_INPUT_INVALID'; END IF;
  SELECT * INTO old FROM review_requests WHERE id=(p_request->>'id')::uuid;
  IF FOUND THEN
    IF old.run_id IS DISTINCT FROM p_run OR old.generation IS DISTINCT FROM p_generation
      OR old.invocation_id IS DISTINCT FROM p_request->>'invocationId' OR old.revision IS DISTINCT FROM (p_request->>'revision')::integer
      OR old.subject_schema IS DISTINCT FROM p_request->>'subjectSchema' OR old.subject_digest IS DISTINCT FROM p_request->>'subjectDigest'
      OR old.subject IS DISTINCT FROM p_request->'subject' OR old.title IS DISTINCT FROM p_request->>'title'
      OR old.expires_at IS DISTINCT FROM (p_request->>'expiresAt')::timestamptz
      THEN RAISE EXCEPTION 'REVIEW_CONFLICT'; END IF;
    RETURN review_read(p_environment,p_generation,p_subject,p_run,old.id);
  END IF;
  SELECT coalesce(max(revision),0)+1 INTO next_revision FROM review_requests
    WHERE run_id=p_run AND invocation_id=p_request->>'invocationId';
  -- A fresh identifier/title must not turn a person's refusal into another prompt
  -- for the same operation. A changed subject or a separately requested run is needed.
  IF EXISTS(SELECT 1 FROM review_requests q JOIN review_decisions d ON d.review_id=q.id
    WHERE q.run_id=p_run AND q.invocation_id=p_request->>'invocationId'
      AND q.subject_schema=p_request->>'subjectSchema' AND q.subject_digest=p_request->>'subjectDigest'
      AND d.outcome='deny') THEN RAISE EXCEPTION 'REVIEW_NOT_OPEN'; END IF;
  expiry := (p_request->>'expiresAt')::timestamptz;
  IF (p_request->>'revision')::integer IS DISTINCT FROM next_revision OR expiry IS NULL OR expiry<=clock_timestamp()
    OR expiry>clock_timestamp()+interval '24 hours' THEN RAISE EXCEPTION 'REVIEW_INPUT_INVALID'; END IF;
  INSERT INTO review_requests(id,run_id,invocation_id,revision,generation,subject_schema,subject_digest,subject,title,expires_at)
    VALUES((p_request->>'id')::uuid,p_run,p_request->>'invocationId',next_revision,p_generation,
      p_request->>'subjectSchema',p_request->>'subjectDigest',p_request->'subject',p_request->>'title',expiry);
  RETURN review_read(p_environment,p_generation,p_subject,p_run,(p_request->>'id')::uuid);
END $$;

CREATE FUNCTION aven_actor_runs.review_decide(p_environment uuid,p_generation bigint,p_subject uuid,p_session text,p_run uuid,p_review uuid,p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,aven_actor_runs AS $$
DECLARE r runs; q review_requests; old review_decisions; latest review_decisions;
BEGIN
  SELECT * INTO r FROM runs WHERE id=p_run AND subject_id=p_subject FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
  PERFORM review_scope(p_environment,p_generation);
  SELECT * INTO q FROM review_requests WHERE id=p_review AND run_id=p_run AND generation=p_generation;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_NOT_FOUND'; END IF;
  IF jsonb_typeof(p_command)<>'object' OR NOT(p_command ?& ARRAY['id','revision','subjectDigest','expectedEventVersion','outcome'])
    OR (p_command-ARRAY['id','revision','subjectDigest','expectedEventVersion','outcome'])<>'{}'::jsonb
    OR coalesce(p_command->>'outcome','') NOT IN ('approve','deny','postpone')
    OR (p_command->>'expectedEventVersion') IS NULL
    OR (p_command->>'expectedEventVersion')::integer<0
    OR (p_command->>'revision')::integer IS DISTINCT FROM q.revision OR p_command->>'subjectDigest' IS DISTINCT FROM q.subject_digest
    THEN RAISE EXCEPTION 'REVIEW_CONFLICT'; END IF;
  SELECT * INTO old FROM review_decisions WHERE id=(p_command->>'id')::uuid;
  IF FOUND THEN
    IF old.review_id IS DISTINCT FROM p_review OR old.reviewer_id IS DISTINCT FROM p_subject OR old.session_id IS DISTINCT FROM p_session
      OR old.outcome IS DISTINCT FROM p_command->>'outcome' OR old.event_version IS DISTINCT FROM (p_command->>'expectedEventVersion')::integer+1
      THEN RAISE EXCEPTION 'REVIEW_CONFLICT'; END IF;
    RETURN review_read(p_environment,p_generation,p_subject,p_run,p_review);
  END IF;
  IF r.state<>'waiting_for_input' OR q.expires_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM review_requests n WHERE n.run_id=p_run AND n.invocation_id=q.invocation_id AND n.revision>q.revision)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.record->'continuations') c
      WHERE c->>'kind'='approval' AND c->>'state' IN ('open','postponed')
      AND c->'review'->>'id'=q.id::text AND (c->'review'->>'revision')::integer=q.revision
      AND c->'review'->>'subjectDigest'=q.subject_digest)
    THEN RAISE EXCEPTION 'REVIEW_NOT_OPEN'; END IF;
  SELECT * INTO latest FROM review_decisions WHERE review_id=p_review ORDER BY event_version DESC LIMIT 1;
  IF coalesce(latest.event_version,0)<>(p_command->>'expectedEventVersion')::integer
    OR latest.outcome IN ('approve','deny') THEN RAISE EXCEPTION 'REVIEW_CONFLICT'; END IF;
  INSERT INTO review_decisions(id,review_id,event_version,reviewer_id,session_id,outcome)
    VALUES((p_command->>'id')::uuid,p_review,coalesce(latest.event_version,0)+1,p_subject,p_session,p_command->>'outcome');
  RETURN review_read(p_environment,p_generation,p_subject,p_run,p_review);
END $$;

REVOKE ALL ON FUNCTION aven_actor_runs.review_scope(uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION aven_actor_runs.review_read(uuid,bigint,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION aven_actor_runs.review_open(uuid,bigint,uuid,uuid,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION aven_actor_runs.review_decide(uuid,bigint,uuid,text,uuid,uuid,jsonb) FROM PUBLIC;
