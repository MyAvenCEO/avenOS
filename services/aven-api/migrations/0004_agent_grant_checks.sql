-- Shape constraints for agent grants. The service validates all of this
-- already; the database saying it too means a future code path — a script, a
-- migration, a hand-written INSERT during an incident — cannot quietly store a
-- grant that no reader knows how to interpret.
ALTER TABLE agent_grants
  ADD CONSTRAINT agent_grants_id_format CHECK (id ~ '^agt_[0-9a-f]{32}$'),
  ADD CONSTRAINT agent_grants_tenant_key_format CHECK (tenant_key ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  ADD CONSTRAINT agent_grants_label_length CHECK (length(label) BETWEEN 1 AND 80),
  ADD CONSTRAINT agent_grants_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- The vocabulary lives here as well as in the service: a scope nobody
  -- enforces is worse than one that was never granted.
  ADD CONSTRAINT agent_grants_scopes_vocabulary
    CHECK (array_length(scopes, 1) BETWEEN 1 AND 2 AND scopes <@ ARRAY['rpc:read', 'rpc:write']::text[]);

-- Deliberately NOT constrained: expires_at > created_at. An expiry in the past
-- means "unusable", which is the safe direction, and forbidding it would take
-- away an operator's ability to expire a grant early without falsifying when
-- it was created.
