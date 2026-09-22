-- Function-only runtime access. The component owner needs SELECT on
-- aven_platform.environment_identity and UPDATE(execution_unsettled). A first
-- claim holds a distinct UUID lifecycle marker through socket shutdown and publication. Only
-- explicit protected-host settlement releases it; expiry never proves shutdown.
-- No runtime role inherits this owner or its platform privileges.
CREATE TABLE aven_credentials.credentials (
  environment_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  credential_ref uuid PRIMARY KEY,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 256),
  kind text NOT NULL CHECK (kind IN ('token','password')),
  secret_version int NOT NULL CHECK (secret_version > 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 65536),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aven_credentials.bindings (
  environment_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  binding_ref uuid PRIMARY KEY,
  credential_ref uuid NOT NULL REFERENCES aven_credentials.credentials,
  revision int NOT NULL CHECK (revision > 0),
  protocol text NOT NULL CHECK (protocol IN ('http','imap')),
  profile jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object' AND octet_length(profile::text) <= 16384),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE aven_credentials.commands (
  environment_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  command_id uuid PRIMARY KEY,
  request jsonb NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- An account reference cannot silently start identifying a different remote
-- principal, even when a new binding is created. Credentials may be rotated or
-- replaced while this remote identity remains immutable.
CREATE TABLE aven_credentials.imap_accounts (
  environment_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  account_ref uuid NOT NULL,
  host text NOT NULL,
  port int NOT NULL,
  login text NOT NULL,
  PRIMARY KEY(environment_id,owner_subject_id,account_ref)
);
CREATE TABLE aven_credentials.uses (
  authorization_id uuid PRIMARY KEY,
  environment_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  protocol text NOT NULL CHECK (protocol IN ('http','imap')),
  invocation_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  binding_ref uuid NOT NULL REFERENCES aven_credentials.bindings,
  binding_revision int NOT NULL,
  credential_ref uuid NOT NULL REFERENCES aven_credentials.credentials,
  secret_version int NOT NULL,
  -- Decision descriptor only: no bearer, secret, applied URL or raw command.
  authority jsonb NOT NULL CHECK (octet_length(authority::text) <= 32768),
  expires_at timestamptz NOT NULL,
  maximum_units int NOT NULL CHECK (maximum_units BETWEEN 1 AND 128),
  settled_at timestamptz,
  UNIQUE(environment_id, invocation_id, attempt_id)
);
CREATE TABLE aven_credentials.claims (
  authorization_id uuid NOT NULL REFERENCES aven_credentials.uses,
  ordinal int NOT NULL CHECK (ordinal BETWEEN 0 AND 127),
  unit_digest text NOT NULL CHECK (unit_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed','succeeded','failed','uncertain')),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  PRIMARY KEY(authorization_id, ordinal)
);

CREATE FUNCTION aven_credentials.assert_scope(p_environment uuid,p_generation bigint,p_execution boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_execution THEN
    -- Acquire the marker lock first; upgrading concurrent shared locks deadlocks.
    PERFORM 1 FROM aven_platform.environment_identity
      WHERE singleton AND environment_id=p_environment
        AND routing_generation=p_generation AND execution_enabled FOR UPDATE;
  ELSE
    PERFORM 1 FROM aven_platform.environment_identity
      WHERE singleton AND environment_id=p_environment
        AND routing_generation=p_generation FOR SHARE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_SCOPE_INVALID', ERRCODE='P0001';
  END IF;
END $$;

CREATE FUNCTION aven_credentials.credential_metadata(p aven_credentials.credentials)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
  SELECT jsonb_build_object('credentialRef',p.credential_ref,'label',p.label,'kind',p.kind,
    'secretVersion',p.secret_version,'enabled',p.enabled,'createdAt',p.created_at,'updatedAt',p.updated_at)
$$;

CREATE FUNCTION aven_credentials.metadata(p_environment uuid,p_owner uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM aven_credentials.assert_scope(p_environment,p_generation);
  SELECT jsonb_build_object(
    'credentials',COALESCE((SELECT jsonb_agg(aven_credentials.credential_metadata(c) ORDER BY c.credential_ref)
      FROM aven_credentials.credentials c WHERE c.environment_id=p_environment AND c.owner_subject_id=p_owner),'[]'::jsonb),
    'bindings',COALESCE((SELECT jsonb_agg(jsonb_build_object('bindingRef',b.binding_ref,
      'credentialRef',b.credential_ref,'revision',b.revision,'protocol',b.protocol,
      'profile',b.profile,'enabled',b.enabled) ORDER BY b.binding_ref)
      FROM aven_credentials.bindings b WHERE b.environment_id=p_environment AND b.owner_subject_id=p_owner),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;

-- Input is already validated, sealed and bound to authenticated scope by ingress.
-- Retrying requires the identical sealed command, or receipt readback. Never retain
-- a plaintext digest to compare passwords. Reuse with changed ciphertext conflicts.
CREATE FUNCTION aven_credentials.admin_command(p_environment uuid,p_owner uuid,p_generation bigint,p_command uuid,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old aven_credentials.commands; c aven_credentials.credentials; b aven_credentials.bindings;
  ref uuid; result jsonb; action text; expected int;
BEGIN
  PERFORM aven_credentials.assert_scope(p_environment,p_generation,true);
  IF p_command IS NULL OR p_owner IS NULL OR p_request IS NULL OR octet_length(p_request::text)>98304 THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_INPUT_INVALID', ERRCODE='P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_command::text,0));
  SELECT * INTO old FROM aven_credentials.commands WHERE command_id=p_command;
  IF FOUND THEN
    IF old.environment_id<>p_environment OR old.owner_subject_id<>p_owner OR old.request<>p_request THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_COMMAND_CONFLICT', ERRCODE='P0001';
    END IF;
    RETURN old.receipt;
  END IF;
  action:=p_request->>'action'; ref:=(p_request->>'credentialRef')::uuid;
  expected:=(p_request->>'expectedVersion')::int;
  IF action='create' THEN
    IF expected<>0 OR expected IS NULL OR p_request->'envelope' IS NULL THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_INPUT_INVALID', ERRCODE='P0001';
    END IF;
    INSERT INTO aven_credentials.credentials(environment_id,owner_subject_id,credential_ref,label,kind,secret_version,envelope)
      VALUES(p_environment,p_owner,ref,p_request->>'label',p_request->>'kind',1,p_request->'envelope') RETURNING * INTO c;
    result:=aven_credentials.credential_metadata(c);
  ELSIF action IN ('rotate','revoke') THEN
    SELECT * INTO c FROM aven_credentials.credentials WHERE credential_ref=ref
      AND environment_id=p_environment AND owner_subject_id=p_owner FOR UPDATE;
    IF NOT FOUND OR c.secret_version IS DISTINCT FROM expected THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_VERSION_CONFLICT', ERRCODE='P0001';
    END IF;
    IF action='rotate' THEN
      IF NOT c.enabled OR p_request->'envelope' IS NULL THEN
        RAISE EXCEPTION USING MESSAGE='CREDENTIAL_NOT_USABLE', ERRCODE='P0001';
      END IF;
      UPDATE aven_credentials.credentials SET envelope=p_request->'envelope',secret_version=secret_version+1,
        updated_at=clock_timestamp() WHERE credential_ref=ref RETURNING * INTO c;
    ELSE
      UPDATE aven_credentials.credentials SET enabled=false,updated_at=clock_timestamp()
        WHERE credential_ref=ref RETURNING * INTO c;
    END IF;
    result:=aven_credentials.credential_metadata(c);
  ELSIF action IN ('binding-set','binding-revoke') THEN
    -- Always lock credential before binding; claims and revocation use the same order.
    SELECT * INTO c FROM aven_credentials.credentials WHERE credential_ref=ref
      AND environment_id=p_environment AND owner_subject_id=p_owner FOR UPDATE;
    IF NOT FOUND OR NOT c.enabled THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_NOT_USABLE', ERRCODE='P0001';
    END IF;
    IF p_request->>'protocol'='imap' AND c.kind<>'password' THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_INPUT_INVALID', ERRCODE='P0001';
    END IF;
    IF action='binding-set' AND p_request->>'protocol'='imap' THEN
      INSERT INTO aven_credentials.imap_accounts VALUES(p_environment,p_owner,
        (p_request->'profile'->>'accountRef')::uuid,p_request->'profile'->>'host',
        (p_request->'profile'->>'port')::int,p_request->'profile'->>'login') ON CONFLICT DO NOTHING;
      IF NOT EXISTS(SELECT FROM aven_credentials.imap_accounts WHERE environment_id=p_environment
        AND owner_subject_id=p_owner AND account_ref=(p_request->'profile'->>'accountRef')::uuid
        AND host=p_request->'profile'->>'host' AND port=(p_request->'profile'->>'port')::int
        AND login=p_request->'profile'->>'login') THEN
        RAISE EXCEPTION USING MESSAGE='CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING', ERRCODE='P0001';
      END IF;
    END IF;
    SELECT * INTO b FROM aven_credentials.bindings WHERE binding_ref=(p_request->>'bindingRef')::uuid FOR UPDATE;
    IF FOUND THEN
      IF b.environment_id<>p_environment OR b.owner_subject_id<>p_owner OR b.credential_ref<>ref
        OR b.protocol IS DISTINCT FROM p_request->>'protocol' OR b.revision IS DISTINCT FROM expected THEN
        RAISE EXCEPTION USING MESSAGE='CREDENTIAL_VERSION_CONFLICT', ERRCODE='P0001';
      END IF;
      IF action='binding-set' AND b.protocol='imap' AND
        (b.profile->'accountRef' IS DISTINCT FROM p_request->'profile'->'accountRef' OR
         b.profile->'host' IS DISTINCT FROM p_request->'profile'->'host' OR
         b.profile->'port' IS DISTINCT FROM p_request->'profile'->'port' OR
         b.profile->'login' IS DISTINCT FROM p_request->'profile'->'login') THEN
        RAISE EXCEPTION USING MESSAGE='CREDENTIAL_ACCOUNT_CHANGE_REQUIRES_NEW_BINDING', ERRCODE='P0001';
      END IF;
      UPDATE aven_credentials.bindings SET revision=revision+1,enabled=action='binding-set',
        profile=CASE WHEN action='binding-set' THEN p_request->'profile' ELSE profile END,updated_at=clock_timestamp()
        WHERE binding_ref=b.binding_ref RETURNING * INTO b;
    ELSE
      IF action<>'binding-set' OR expected IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION USING MESSAGE='CREDENTIAL_VERSION_CONFLICT', ERRCODE='P0001';
      END IF;
      INSERT INTO aven_credentials.bindings(environment_id,owner_subject_id,binding_ref,credential_ref,revision,protocol,profile)
        VALUES(p_environment,p_owner,(p_request->>'bindingRef')::uuid,ref,1,p_request->>'protocol',p_request->'profile') RETURNING * INTO b;
    END IF;
    result:=jsonb_build_object('bindingRef',b.binding_ref,'revision',b.revision,'enabled',b.enabled);
  ELSE
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_INPUT_INVALID', ERRCODE='P0001';
  END IF;
  INSERT INTO aven_credentials.commands VALUES(p_environment,p_owner,p_command,p_request,result,clock_timestamp());
  RETURN result;
END $$;

CREATE FUNCTION aven_credentials.command_receipt(p_environment uuid,p_owner uuid,p_generation bigint,p_command uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM aven_credentials.assert_scope(p_environment,p_generation);
  RETURN (SELECT receipt FROM aven_credentials.commands WHERE command_id=p_command
    AND environment_id=p_environment AND owner_subject_id=p_owner);
END $$;

-- Private core: only protocol-specific wrappers below receive runtime grants.
-- The executor verifies the signed, audience-bound authority before entering here.
CREATE FUNCTION aven_credentials.claim_unit(p_protocol text,p_authority jsonb,p_ordinal int,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c aven_credentials.credentials; b aven_credentials.bindings; u aven_credentials.uses;
  previous aven_credentials.claims; environment uuid; owner_id uuid; use_id uuid;
BEGIN
  environment:=(p_authority->>'environmentId')::uuid;
  owner_id:=(p_authority->>'subjectId')::uuid;
  use_id:=(p_authority->>'authorizationId')::uuid;
  PERFORM aven_credentials.assert_scope(environment,(p_authority->>'generation')::bigint,true);
  IF p_authority->>'protocol' IS DISTINCT FROM p_protocol
    OR (p_authority->>'expiresAt')::timestamptz<=clock_timestamp()
    OR (p_authority->>'expiresAt')::timestamptz>clock_timestamp()+interval '5 minutes'
    OR p_ordinal IS NULL OR p_ordinal<0 OR p_ordinal>=(p_authority->>'maximumUnits')::int
    OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_DENIED', ERRCODE='P0001';
  END IF;
  SELECT * INTO c FROM aven_credentials.credentials WHERE credential_ref=(p_authority->>'credentialRef')::uuid
    AND environment_id=environment AND owner_subject_id=owner_id FOR UPDATE;
  IF NOT FOUND OR NOT c.enabled OR c.secret_version IS DISTINCT FROM (p_authority->>'secretVersion')::int THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_NOT_USABLE', ERRCODE='P0001';
  END IF;
  SELECT * INTO b FROM aven_credentials.bindings WHERE binding_ref=(p_authority->>'bindingRef')::uuid
    AND environment_id=environment AND owner_subject_id=owner_id FOR UPDATE;
  IF NOT FOUND OR NOT b.enabled OR b.protocol<>p_protocol OR b.credential_ref<>c.credential_ref
    OR b.revision IS DISTINCT FROM (p_authority->>'bindingRevision')::int THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_NOT_USABLE', ERRCODE='P0001';
  END IF;
  INSERT INTO aven_credentials.uses VALUES(use_id,environment,owner_id,(p_authority->>'generation')::bigint,
    p_protocol,(p_authority->>'invocationId')::uuid,(p_authority->>'attemptId')::uuid,b.binding_ref,b.revision,
    c.credential_ref,c.secret_version,p_authority,(p_authority->>'expiresAt')::timestamptz,(p_authority->>'maximumUnits')::int,NULL)
    ON CONFLICT(authorization_id) DO NOTHING;
  IF FOUND THEN
    UPDATE aven_platform.environment_identity SET execution_unsettled=array_append(execution_unsettled,use_id)
      WHERE singleton AND environment_id=environment AND NOT use_id=ANY(execution_unsettled)
        AND use_id IS DISTINCT FROM (p_authority->>'runId')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_FENCE_INCONSISTENT', ERRCODE='P0001';
    END IF;
  END IF;
  SELECT * INTO u FROM aven_credentials.uses WHERE authorization_id=use_id FOR UPDATE;
  IF u.authority<>p_authority THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_CONFLICT', ERRCODE='P0001';
  END IF;
  SELECT * INTO previous FROM aven_credentials.claims WHERE authorization_id=use_id AND ordinal=p_ordinal;
  IF FOUND THEN
    IF previous.unit_digest<>p_digest THEN
      RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_CONFLICT', ERRCODE='P0001';
    END IF;
    -- A replay never releases ciphertext, even if the preceding response was lost.
    RETURN jsonb_build_object('outcome','already-claimed','state',previous.state);
  END IF;
  IF u.settled_at IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_SETTLED', ERRCODE='P0001';
  END IF;
  IF p_ordinal<>(SELECT count(*) FROM aven_credentials.claims WHERE authorization_id=use_id) THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_UNIT_ORDER_INVALID', ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT FROM aven_credentials.claims WHERE authorization_id=use_id AND state<>'succeeded') THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_PREVIOUS_UNIT_UNSETTLED', ERRCODE='P0001';
  END IF;
  INSERT INTO aven_credentials.claims(authorization_id,ordinal,unit_digest) VALUES(use_id,p_ordinal,p_digest);
  RETURN jsonb_build_object('outcome','claimed','envelope',c.envelope,'kind',c.kind,'profile',b.profile);
END $$;

CREATE FUNCTION aven_credentials.claim_http(p_authority jsonb,p_ordinal int,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.claim_unit('http',p_authority,p_ordinal,p_digest)
$$;
CREATE FUNCTION aven_credentials.claim_imap(p_authority jsonb,p_ordinal int,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.claim_unit('imap',p_authority,p_ordinal,p_digest)
$$;

CREATE FUNCTION aven_credentials.finish_unit(p_protocol text,p_environment uuid,p_owner uuid,p_authorization uuid,p_ordinal int,p_digest text,p_state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c aven_credentials.claims; u aven_credentials.uses;
BEGIN
  SELECT * INTO u FROM aven_credentials.uses WHERE authorization_id=p_authorization AND environment_id=p_environment
    AND owner_subject_id=p_owner AND protocol=p_protocol;
  IF NOT FOUND OR p_state IS NULL OR p_state NOT IN ('succeeded','failed','uncertain') THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_DENIED', ERRCODE='P0001';
  END IF;
  PERFORM aven_credentials.assert_scope(p_environment,u.generation);
  SELECT * INTO c FROM aven_credentials.claims WHERE authorization_id=p_authorization AND ordinal=p_ordinal FOR UPDATE;
  IF NOT FOUND OR c.unit_digest IS DISTINCT FROM p_digest OR (c.state<>'claimed' AND c.state<>p_state) THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_CONFLICT', ERRCODE='P0001';
  END IF;
  UPDATE aven_credentials.claims SET state=p_state,finished_at=COALESCE(finished_at,clock_timestamp())
    WHERE authorization_id=p_authorization AND ordinal=p_ordinal;
END $$;
CREATE FUNCTION aven_credentials.finish_http(p_environment uuid,p_owner uuid,p_authorization uuid,p_ordinal int,p_digest text,p_state text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.finish_unit('http',p_environment,p_owner,p_authorization,p_ordinal,p_digest,p_state)
$$;
CREATE FUNCTION aven_credentials.finish_imap(p_environment uuid,p_owner uuid,p_authorization uuid,p_ordinal int,p_digest text,p_state text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.finish_unit('imap',p_environment,p_owner,p_authorization,p_ordinal,p_digest,p_state)
$$;

-- Called only by the protected host which won the first claim, after all network
-- activity and publication has stopped. A replay handler must never call this.
-- Revocation/suspension/expiry do not prevent shutdown accounting. A crashed host
-- leaves the fence in place until an operator proves the old process is stopped.
CREATE FUNCTION aven_credentials.settle_use(p_protocol text,p_environment uuid,p_owner uuid,p_authorization uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u aven_credentials.uses;
BEGIN
  PERFORM 1 FROM aven_platform.environment_identity
    WHERE singleton AND environment_id=p_environment FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_SCOPE_INVALID', ERRCODE='P0001';
  END IF;
  SELECT * INTO u FROM aven_credentials.uses WHERE authorization_id=p_authorization
    AND environment_id=p_environment AND owner_subject_id=p_owner AND protocol=p_protocol FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_USE_DENIED', ERRCODE='P0001';
  END IF;
  IF u.settled_at IS NOT NULL THEN RETURN; END IF;
  UPDATE aven_platform.environment_identity SET execution_unsettled=array_remove(execution_unsettled,p_authorization)
    WHERE singleton AND environment_id=p_environment AND p_authorization=ANY(execution_unsettled);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='CREDENTIAL_FENCE_INCONSISTENT', ERRCODE='P0001';
  END IF;
  UPDATE aven_credentials.uses SET settled_at=clock_timestamp() WHERE authorization_id=p_authorization;
END $$;
CREATE FUNCTION aven_credentials.settle_http(p_environment uuid,p_owner uuid,p_authorization uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.settle_use('http',p_environment,p_owner,p_authorization)
$$;
CREATE FUNCTION aven_credentials.settle_imap(p_environment uuid,p_owner uuid,p_authorization uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
  SELECT aven_credentials.settle_use('imap',p_environment,p_owner,p_authorization)
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA aven_credentials FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA aven_credentials FROM PUBLIC;
